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

    private static final String[] TERMINAL_STATES = { "COMPLETED", "CANCELED" };

    private final CamundaRestClient restClient;
    private final MessagePublisher messagePublisher;
    private final SessionRepository sessionRepository;
    private final String processId;
    private final String startMessageName;
    private final String replyMessageName;
    private final int maxPiSearchAttempts;
    private final long piSearchDelayMs;
    private final int emptyPollsBeforeExpiryCheck;

    public CamundaChatService(
            CamundaRestClient restClient,
            MessagePublisher messagePublisher,
            SessionRepository sessionRepository,
            @Value("${app.camunda.process-id}") String processId,
            @Value("${app.camunda.messages.start}") String startMessageName,
            @Value("${app.camunda.messages.reply}") String replyMessageName,
            @Value("${app.polling.pi-search-max-attempts}") int maxPiSearchAttempts,
            @Value("${app.polling.pi-search-delay-ms}") long piSearchDelayMs,
            @Value("${app.polling.empty-polls-before-expiry-check}") int emptyPollsBeforeExpiryCheck) {
        this.restClient = restClient;
        this.messagePublisher = messagePublisher;
        this.sessionRepository = sessionRepository;
        this.processId = processId;
        this.startMessageName = startMessageName;
        this.replyMessageName = replyMessageName;
        this.maxPiSearchAttempts = maxPiSearchAttempts;
        this.piSearchDelayMs = piSearchDelayMs;
        this.emptyPollsBeforeExpiryCheck = emptyPollsBeforeExpiryCheck;
    }

    @Override
    public SessionState startSession(String inputText) {
        String sessionId = UUID.randomUUID().toString();

        Map<String, Object> variables = Map.of(
                "sessionId", sessionId,
                "inputText", inputText,
                "inputDocuments", Collections.emptyList());

        try {
            messagePublisher.publish(startMessageName, "", variables);
        } catch (Exception e) {
            throw new ProcessStartException("Failed to publish start message: " + e.getMessage(), e);
        }

        log.info("Published {} message for session {}", startMessageName, sessionId);

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
            session.resetConsecutiveErrors();

            String routeCategory = extractRouteCategory(variables);
            String responseText = extractResponseText(variables.get("agent"));
            String handledBy = resolveAgentLabel(routeCategory);
            String accepted = session.checkAndAcceptNewResponse(responseText, handledBy);
            if (accepted != null) {
                return new ChatResponseDTO("ready", accepted, handledBy);
            }

            return lastKnownOrProcessing(session);

        } catch (SessionExpiredException e) {
            throw e;
        } catch (Exception e) {
            session.incrementConsecutiveErrors();
            if (session.getConsecutiveErrors() >= 3) {
                log.error("Persistent error getting response for session {} ({} consecutive): {}",
                        sessionId, session.getConsecutiveErrors(), e.getMessage());
                return new ChatResponseDTO("error",
                        "Unable to retrieve response. Please try again or start a new chat.", null);
            }
            log.warn("Transient error getting response for session {}: {}", sessionId, e.getMessage());
            return new ChatResponseDTO("processing", null, null);
        }
    }

    @Override
    public void sendReply(String sessionId, String followUpInput) {
        SessionState session = sessionRepository.getActiveSession(sessionId);

        Map<String, Object> variables = Map.of(
                "followUpInput", followUpInput,
                "followUpDocuments", Collections.emptyList());

        try {
            messagePublisher.publish(replyMessageName, sessionId, variables);
        } catch (Exception e) {
            log.error("Failed to publish reply for session {}: {}", sessionId, e.getMessage());
            if (restClient.isProcessInstanceInState(session.getProcessInstanceKey(), TERMINAL_STATES)) {
                session.setExpired(true);
                throw new SessionExpiredException(sessionId);
            }
            throw new RuntimeException("Failed to send reply: " + e.getMessage(), e);
        }

        session.setAwaitingResponse(true);
        log.info("Published {} for session {}", replyMessageName, sessionId);
    }

    private ChatResponseDTO handleEmptyVariables(SessionState session) {
        session.incrementEmptyPolls();

        // Early warning: surface potential API connectivity issues before the expiry
        // threshold
        if (session.getConsecutiveEmptyPolls() == 5 && session.isAwaitingResponse()) {
            log.warn("Session {} has had {} consecutive empty variable polls — possible Camunda API connectivity issue",
                    session.getSessionId(), session.getConsecutiveEmptyPolls());
        }

        if (session.getConsecutiveEmptyPolls() >= emptyPollsBeforeExpiryCheck) {
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
            return new ChatResponseDTO("ready", session.getLastResponseText(), session.getLastHandledBy());
        }
        return new ChatResponseDTO("processing", null, null);
    }

    private String findProcessInstanceKey(String sessionId) {
        List<Map<String, String>> sort = List.of(Map.of("field", "startDate", "order", "DESC"));

        for (int attempt = 1; attempt <= maxPiSearchAttempts; attempt++) {
            try {
                Map<String, Object> filter = new HashMap<>();
                filter.put("processDefinitionId", processId);
                filter.put("state", "ACTIVE");

                List<JsonNode> items = restClient.searchProcessInstances(filter, 20, sort);
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
                        attempt, maxPiSearchAttempts, sessionId, e.getMessage());
            }

            sleep(piSearchDelayMs);
        }

        throw new ProcessStartException(
                "Could not find process instance for session " + sessionId
                        + " after " + maxPiSearchAttempts + " attempts. "
                        + "Ensure the BPMN process is deployed to the cluster.");
    }

    private String extractRouteCategory(Map<String, Object> variables) {
        Object rc = variables.get("routeCategory");
        return rc != null ? rc.toString() : null;
    }

    private static final Map<String, String> AGENT_LABELS = Map.of(
            "user_data", "User Data Agent",
            "content", "Content & Entertainment Agent",
            "utility", "Utility & Web Agent",
            "general", "General Agent");

    private String resolveAgentLabel(String routeCategory) {
        if (routeCategory == null)
            return null;
        return AGENT_LABELS.getOrDefault(routeCategory, routeCategory);
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
