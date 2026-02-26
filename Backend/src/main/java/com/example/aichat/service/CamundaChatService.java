package com.example.aichat.service;

import com.example.aichat.client.CamundaRestClient;
import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.exception.ProcessStartException;
import com.example.aichat.exception.SessionExpiredException;
import com.example.aichat.model.SessionState;
import com.example.aichat.repository.SessionRepository;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class CamundaChatService implements ChatService {

    private static final Logger log = LoggerFactory.getLogger(CamundaChatService.class);

    private static final int MAX_PI_SEARCH_ATTEMPTS = 20;
    private static final long PI_SEARCH_DELAY_MS = 1500;
    private static final int EMPTY_POLLS_BEFORE_EXPIRY_CHECK = 60;
    private static final String[] TERMINAL_STATES = {"COMPLETED", "CANCELED"};

    private final CamundaRestClient restClient;
    private final MessagePublisher messagePublisher;
    private final SessionRepository sessionRepository;

    @Value("${app.camunda.process-id}")
    private String processId;

    public CamundaChatService(
            CamundaRestClient restClient,
            MessagePublisher messagePublisher,
            SessionRepository sessionRepository) {
        this.restClient = restClient;
        this.messagePublisher = messagePublisher;
        this.sessionRepository = sessionRepository;
    }

    @Override
    public SessionState startSession(String inputText) {
        String sessionId = UUID.randomUUID().toString();

        Map<String, Object> variables = Map.of(
                "sessionId", sessionId,
                "inputText", inputText,
                "inputDocuments", Collections.emptyList()
        );

        try {
            messagePublisher.publish("ai-chat-start", "", variables);
        } catch (Exception e) {
            throw new ProcessStartException("Failed to publish start message: " + e.getMessage(), e);
        }

        log.info("Published ai-chat-start message for session {}", sessionId);

        String processInstanceKey = findProcessInstanceKey(sessionId);
        SessionState session = new SessionState(sessionId, processInstanceKey);
        sessionRepository.save(session);

        return session;
    }

    @Override
    public ChatResponseDTO getResponse(String sessionId) {
        SessionState session = sessionRepository.getActiveSession(sessionId);

        try {
            Map<String, Object> variables = restClient.fetchProcessInstanceVariables(
                    session.getProcessInstanceKey());

            if (variables.isEmpty()) {
                return handleEmptyVariables(session);
            }

            session.resetEmptyPolls();

            Object agentVar = variables.get("agent");
            log.debug("Session {}: agent variable type={}, value={}",
                    sessionId, agentVar == null ? "null" : agentVar.getClass().getSimpleName(), agentVar);

            String responseText = extractResponseText(agentVar);
            log.debug("Session {}: extractResponseText returned: {}", sessionId,
                    responseText != null ? responseText.substring(0, Math.min(80, responseText.length())) + "..." : "null");

            String accepted = session.checkAndAcceptNewResponse(responseText);
            if (accepted != null) {
                return new ChatResponseDTO("ready", accepted);
            }

            return lastKnownOrProcessing(session);

        } catch (SessionExpiredException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error getting response for session {}: {}", sessionId, e.getMessage());
            return new ChatResponseDTO("processing", null);
        }
    }

    @Override
    public void sendReply(String sessionId, String followUpInput) {
        SessionState session = sessionRepository.getActiveSession(sessionId);

        Map<String, Object> variables = Map.of(
                "followUpInput", followUpInput,
                "followUpDocuments", Collections.emptyList()
        );

        try {
            messagePublisher.publish("ai-chat-user-reply", sessionId, variables);
        } catch (Exception e) {
            log.error("Failed to publish reply for session {}: {}", sessionId, e.getMessage());
            if (restClient.isProcessInstanceInState(session.getProcessInstanceKey(), TERMINAL_STATES)) {
                session.setExpired(true);
                throw new SessionExpiredException(sessionId);
            }
            throw new RuntimeException("Failed to send reply: " + e.getMessage(), e);
        }

        session.setAwaitingResponse(true);
        log.info("Published ai-chat-user-reply for session {}", sessionId);
    }

    private ChatResponseDTO handleEmptyVariables(SessionState session) {
        session.incrementEmptyPolls();

        if (session.getConsecutiveEmptyPolls() >= EMPTY_POLLS_BEFORE_EXPIRY_CHECK) {
            if (restClient.isProcessInstanceInState(session.getProcessInstanceKey(), TERMINAL_STATES)) {
                session.setExpired(true);
                throw new SessionExpiredException(session.getSessionId());
            }
            session.resetEmptyPolls();
        }

        return lastKnownOrProcessing(session);
    }

    private ChatResponseDTO lastKnownOrProcessing(SessionState session) {
        if (!session.isAwaitingResponse() && session.getLastResponseText() != null) {
            return new ChatResponseDTO("ready", session.getLastResponseText());
        }
        return new ChatResponseDTO("processing", null);
    }

    private String findProcessInstanceKey(String sessionId) {
        List<Map<String, String>> sort = List.of(Map.of("field", "startDate", "order", "DESC"));

        for (int attempt = 1; attempt <= MAX_PI_SEARCH_ATTEMPTS; attempt++) {
            try {
                Map<String, Object> filter = new HashMap<>();
                filter.put("processDefinitionId", processId);
                filter.put("state", "ACTIVE");

                List<JsonNode> items = restClient.searchProcessInstances(filter, 5, sort);
                log.debug("Attempt {}/{} for session {}: found {} active instance(s)",
                        attempt, MAX_PI_SEARCH_ATTEMPTS, sessionId, items.size());

                for (JsonNode piNode : items) {
                    String piKey = piNode.path("processInstanceKey").isTextual()
                            ? piNode.path("processInstanceKey").asText()
                            : String.valueOf(piNode.path("processInstanceKey").asLong());

                    Map<String, Object> piVars = restClient.fetchProcessInstanceVariables(piKey);
                    if (sessionId.equals(piVars.get("sessionId"))) {
                        log.info("Found process instance {} for session {} on attempt {}",
                                piKey, sessionId, attempt);
                        return piKey;
                    }
                }
            } catch (Exception e) {
                log.warn("Attempt {}/{} to find PI for session {} failed: {}",
                        attempt, MAX_PI_SEARCH_ATTEMPTS, sessionId, e.getMessage());
            }

            sleep(PI_SEARCH_DELAY_MS);
        }

        throw new ProcessStartException(
                "Could not find process instance for session " + sessionId
                        + " after " + MAX_PI_SEARCH_ATTEMPTS + " attempts. "
                        + "Ensure the BPMN process is deployed to the cluster.");
    }

    private String extractResponseText(Object agentVar) {
        if (agentVar instanceof Map<?, ?> agentMap) {
            Object rt = agentMap.get("responseText");
            return rt != null ? rt.toString() : null;
        }
        return null;
    }

    private void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
