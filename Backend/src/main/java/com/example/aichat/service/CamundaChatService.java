package com.example.aichat.service;

import com.example.aichat.client.CamundaRestClient;
import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.exception.ProcessStartException;
import com.example.aichat.exception.SessionExpiredException;
import com.example.aichat.model.SessionState;
import com.example.aichat.repository.SessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Collections;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Service
public class CamundaChatService implements ChatService {

    private static final Logger log = LoggerFactory.getLogger(CamundaChatService.class);

    private static final String[] TERMINAL_STATES = {"COMPLETED", "CANCELED"};

    /**
     * One thread per processor; handles all active SSE poll loops.
     */
    private final ScheduledExecutorService streamScheduler =
            new ScheduledThreadPoolExecutor(Runtime.getRuntime().availableProcessors());

    private final CamundaRestClient restClient;
    private final MessagePublisher messagePublisher;
    private final SessionRepository sessionRepository;
    private final String startMessageName;
    private final String replyMessageName;
    private final int emptyPollsBeforeExpiryCheck;

    public CamundaChatService(
            CamundaRestClient restClient,
            MessagePublisher messagePublisher,
            SessionRepository sessionRepository,
            @Value("${app.camunda.messages.start}") String startMessageName,
            @Value("${app.camunda.messages.reply}") String replyMessageName,
            @Value("${app.polling.empty-polls-before-expiry-check}") int emptyPollsBeforeExpiryCheck) {
        this.restClient = restClient;
        this.messagePublisher = messagePublisher;
        this.sessionRepository = sessionRepository;
        this.startMessageName = startMessageName;
        this.replyMessageName = replyMessageName;
        this.emptyPollsBeforeExpiryCheck = emptyPollsBeforeExpiryCheck;
    }

    @Override
    public SessionState startSession(String inputText) {
        String sessionId = UUID.randomUUID().toString();

        Map<String, Object> variables = Map.of(
                "sessionId", sessionId,
                "inputText", inputText,
                "inputDocuments", Collections.emptyList());

        long processInstanceKey;
        try {
            processInstanceKey = messagePublisher.correlate(startMessageName, "", variables);
        } catch (Exception e) {
            throw new ProcessStartException("Failed to correlate start message: " + e.getMessage(), e);
        }

        log.info("Correlated {} message for session {}, processInstanceKey: {}",
                startMessageName, sessionId, processInstanceKey);

        SessionState session = new SessionState(sessionId, String.valueOf(processInstanceKey));
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

    @Override
    public SseEmitter streamResponse(String sessionId) {
        // Validate session exists and is active before opening the stream
        sessionRepository.getActiveSession(sessionId);

        // 10-minute emitter timeout -- matches session max-age
        SseEmitter emitter = new SseEmitter(600_000L);

        ScheduledFuture<?>[] futureHolder = new ScheduledFuture<?>[1];

        Runnable cancelFuture = () -> {
            if (futureHolder[0] != null) futureHolder[0].cancel(false);
        };
        emitter.onCompletion(cancelFuture);
        emitter.onTimeout(cancelFuture);
        emitter.onError(t -> cancelFuture.run());

        futureHolder[0] = streamScheduler.scheduleWithFixedDelay(() -> {
            try {
                ChatResponseDTO dto = getResponse(sessionId);
                emitter.send(SseEmitter.event()
                        .data(dto, MediaType.APPLICATION_JSON));

                if ("ready".equals(dto.status()) || "error".equals(dto.status())) {
                    emitter.complete();
                }
            } catch (SessionExpiredException e) {
                sendSilently(emitter, new ChatResponseDTO("expired",
                        "Session expired.", null));
                emitter.complete();
            } catch (IOException e) {
                // Client disconnected -- stop polling quietly
                emitter.completeWithError(e);
            } catch (Exception e) {
                log.warn("SSE poll error for session {}: {}", sessionId, e.getMessage());
                emitter.completeWithError(e);
            }
        }, 0, 1, TimeUnit.SECONDS);

        return emitter;
    }

    private void sendSilently(SseEmitter emitter, ChatResponseDTO dto) {
        try {
            emitter.send(SseEmitter.event().data(dto, MediaType.APPLICATION_JSON));
        } catch (IOException ignored) {
        }
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

}
