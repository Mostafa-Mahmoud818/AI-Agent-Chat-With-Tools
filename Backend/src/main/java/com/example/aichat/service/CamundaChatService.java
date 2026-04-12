package com.example.aichat.service;

import com.example.aichat.camunda.CamundaRestClient;
import com.example.aichat.camunda.MessagePublisher;
import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.exception.ProcessStartException;
import com.example.aichat.exception.SessionExpiredException;
import com.example.aichat.model.SessionState;
import com.example.aichat.repository.SessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class CamundaChatService {

    private static final Logger log = LoggerFactory.getLogger(CamundaChatService.class);
    /** Camunda v2 process-instances search filter: ACTIVE | COMPLETED | TERMINATED (not CANCELED). */
    private static final String[] TERMINAL_STATES = { "COMPLETED", "TERMINATED" };

    private static final String VAR_SESSION_ID = "sessionId";
    private static final String VAR_INPUT_TEXT = "inputText";
    private static final String VAR_INPUT_DOCUMENTS = "inputDocuments";
    private static final String VAR_FOLLOW_UP_INPUT = "followUpInput";
    private static final String VAR_FOLLOW_UP_DOCUMENTS = "followUpDocuments";

    private static final Map<String, String> AGENT_LABELS = Map.of(
            "user_data", "User Data Agent",
            "utility", "Utility & Web Agent",
            "general", "General Agent");

    private final CamundaRestClient camundaRestClient;
    private final MessagePublisher messagePublisher;
    private final SessionRepository sessionStore;
    private final SseStreamOrchestrator sseStreamOrchestrator;
    private final String startMessageName;
    private final String replyMessageName;
    private final int stalePollsBeforeGatewayCheck;
    private final int maxConsecutiveErrors;
    private final int emptyPollsBeforeExpiryCheck;
    private final String replyCatchEventId;

    public CamundaChatService(
            CamundaRestClient camundaRestClient,
            MessagePublisher messagePublisher,
            SessionRepository sessionStore,
            SseStreamOrchestrator sseStreamOrchestrator,
            @Value("${app.camunda.messages.start}") String startMessageName,
            @Value("${app.camunda.messages.reply}") String replyMessageName,
            @Value("${app.polling.stale-polls-before-gateway-check:30}") int stalePollsBeforeGatewayCheck,
            @Value("${app.polling.max-consecutive-errors:3}") int maxConsecutiveErrors,
            @Value("${app.polling.empty-polls-before-expiry-check}") int emptyPollsBeforeExpiryCheck,
            @Value("${app.camunda.reply-catch-event-id:MessageCatchEvent_UserReply}") String replyCatchEventId) {
        this.camundaRestClient = camundaRestClient;
        this.messagePublisher = messagePublisher;
        this.sessionStore = sessionStore;
        this.sseStreamOrchestrator = sseStreamOrchestrator;
        this.startMessageName = startMessageName;
        this.replyMessageName = replyMessageName;
        this.stalePollsBeforeGatewayCheck = stalePollsBeforeGatewayCheck;
        this.maxConsecutiveErrors = maxConsecutiveErrors;
        this.emptyPollsBeforeExpiryCheck = emptyPollsBeforeExpiryCheck;
        this.replyCatchEventId = replyCatchEventId;
    }

    public SessionState startSession(String inputText) {
        String sessionId = UUID.randomUUID().toString();
        Map<String, Object> variables = Map.of(
                VAR_SESSION_ID, sessionId,
                VAR_INPUT_TEXT, inputText,
                VAR_INPUT_DOCUMENTS, Collections.emptyList());

        long processInstanceKey;
        try {
            processInstanceKey = messagePublisher.correlate(startMessageName, "", variables);
        } catch (Exception e) {
            throw new ProcessStartException("Failed to correlate start message: " + e.getMessage(), e);
        }

        SessionState session = new SessionState(sessionId, String.valueOf(processInstanceKey));
        sessionStore.save(session);
        return session;
    }

    public ChatResponseDTO getResponse(String sessionId) {
        SessionState session = sessionStore.getActiveSession(sessionId);

        try {
            Map<String, Object> variables = camundaRestClient.fetchProcessInstanceVariables(
                    session.getProcessInstanceKey());

            if (variables.isEmpty()) {
                return handleEmptyVariables(session);
            }

            session.resetEmptyPolls();
            session.resetConsecutiveErrors();

            Object agentVar = variables.get("agent");
            String routeCategory = extractRouteCategory(variables);
            String responseText = extractResponseText(agentVar);
            String handledBy = resolveAgentLabel(routeCategory);
            int agentHash = agentVar != null ? agentVar.hashCode() : 0;

            if (log.isDebugEnabled()) {
                log.debug("Session {} — routeCategory={}, responseText={}, agentHash={}",
                        sessionId, routeCategory,
                        responseText != null ? responseText.substring(0, Math.min(80, responseText.length())) : "null",
                        agentHash);
            }

            String accepted = session.checkAndAcceptNewResponse(responseText, handledBy, agentHash);
            if (accepted != null) {
                return new ChatResponseDTO("ready", accepted, handledBy);
            }

            if (responseText != null && session.getConsecutiveStalePollsWhileAwaiting() >= stalePollsBeforeGatewayCheck) {
                return handleStaleResponse(session, responseText, handledBy, agentHash);
            }

            return lastKnownOrProcessing(session);

        } catch (Exception e) {
            if (e instanceof SessionExpiredException) throw (SessionExpiredException) e;
            session.incrementConsecutiveErrors();
            if (session.getConsecutiveErrors() >= maxConsecutiveErrors) {
                log.error("Persistent error getting response for session {} ({} consecutive): {}",
                        sessionId, session.getConsecutiveErrors(), e.getMessage());
                return new ChatResponseDTO("error",
                        "Unable to retrieve response. Please try again or start a new chat.", null);
            }
            log.warn("Transient error getting response for session {}: {}", sessionId, e.getMessage());
            return new ChatResponseDTO("processing", null, null);
        }
    }

    public void sendReply(String sessionId, String followUpInput) {
        SessionState session = sessionStore.getActiveSession(sessionId);

        Map<String, Object> variables = Map.of(
                VAR_FOLLOW_UP_INPUT, followUpInput,
                VAR_FOLLOW_UP_DOCUMENTS, Collections.emptyList());

        try {
            messagePublisher.publish(replyMessageName, sessionId, variables);
        } catch (Exception e) {
            log.error("Failed to publish reply for session {}: {}", sessionId, e.getMessage());
            if (camundaRestClient.isProcessInstanceInState(session.getProcessInstanceKey(), TERMINAL_STATES)) {
                session.setExpired(true);
                throw new SessionExpiredException(sessionId);
            }
            throw new RuntimeException("Failed to send reply: " + e.getMessage(), e);
        }

        session.setAwaitingResponse(true);
        log.info("Published {} for session {}", replyMessageName, sessionId);
    }

    public SseEmitter streamResponse(String sessionId) {
        return sseStreamOrchestrator.streamResponse(sessionId);
    }

    // --- Response resolution ---

    private ChatResponseDTO handleEmptyVariables(SessionState session) {
        session.incrementEmptyPolls();

        if (session.getConsecutiveEmptyPolls() == 5 && session.isAwaitingResponse()) {
            log.warn("Session {} — {} consecutive empty polls, possible Camunda API issue",
                    session.getSessionId(), session.getConsecutiveEmptyPolls());
        }

        session.resetConsecutiveErrors();

        if (session.getConsecutiveEmptyPolls() >= emptyPollsBeforeExpiryCheck) {
            if (camundaRestClient.isProcessInstanceInState(session.getProcessInstanceKey(), TERMINAL_STATES)) {
                session.setExpired(true);
                throw new SessionExpiredException(session.getSessionId());
            }
            session.resetEmptyPolls();
        }

        return lastKnownOrProcessing(session);
    }

    private ChatResponseDTO handleStaleResponse(SessionState session, String responseText,
            String handledBy, int agentHash) {
        String piKey = session.getProcessInstanceKey();
        log.info("Session {} — {} stale polls, checking gateway state for PI {}",
                session.getSessionId(), session.getConsecutiveStalePollsWhileAwaiting(), piKey);

        if (camundaRestClient.isFlowNodeActive(piKey, replyCatchEventId)) {
            log.info("Session {} — catch event active, force-accepting response", session.getSessionId());
            session.forceAcceptCurrentResponse(responseText, handledBy, agentHash);
            return new ChatResponseDTO("ready", responseText, handledBy);
        }

        if (camundaRestClient.isProcessInstanceInState(piKey, TERMINAL_STATES)) {
            session.setExpired(true);
            throw new SessionExpiredException(session.getSessionId());
        }

        session.resetStalePollsWhileAwaiting();
        return lastKnownOrProcessing(session);
    }

    private ChatResponseDTO lastKnownOrProcessing(SessionState session) {
        if (!session.isAwaitingResponse() && session.getLastResponseText() != null) {
            return new ChatResponseDTO("ready", session.getLastResponseText(), session.getLastHandledBy());
        }
        return new ChatResponseDTO("processing", null, null);
    }

    // --- Variable mapping ---

    private static String extractRouteCategory(Map<String, Object> variables) {
        Object rc = variables.get("routeCategory");
        return rc != null ? rc.toString() : null;
    }

    private static String extractResponseText(Object agentVar) {
        if (!(agentVar instanceof Map<?, ?> agentMap)) return null;

        // Primary: agent.responseText (set by connector when model produces a final text response)
        Object rt = agentMap.get("responseText");
        if (rt != null && !rt.toString().isBlank()) {
            return rt.toString();
        }

        // Fallback: extract from conversation messages when the model's final response is empty
        // (e.g. model returned STOP with no content after a tool call result)
        return extractFromConversation(agentMap);
    }

    @SuppressWarnings("unchecked")
    private static String extractFromConversation(Map<?, ?> agentMap) {
        Object conv = agentMap.get("conversation");
        if (!(conv instanceof Map<?, ?> convMap)) return null;

        Object msgs = convMap.get("messages");
        if (!(msgs instanceof List<?> msgList) || msgList.isEmpty()) return null;

        // Walk messages in reverse: find last assistant content or tool_call_result content
        for (int i = msgList.size() - 1; i >= 0; i--) {
            if (!(msgList.get(i) instanceof Map<?, ?> msg)) continue;
            String role = String.valueOf(msg.get("role"));

            if ("assistant".equals(role)) {
                String text = extractMessageContent(msg);
                if (text != null && !text.isBlank()) return text;
                continue; // empty assistant message — check earlier messages
            }

            if ("tool_call_result".equals(role)) {
                Object results = msg.get("results");
                if (results instanceof List<?> resultList) {
                    for (Object r : resultList) {
                        if (r instanceof Map<?, ?> resultMap) {
                            Object content = resultMap.get("content");
                            if (content != null && !content.toString().isBlank()) {
                                return content.toString();
                            }
                        }
                    }
                }
            }

            if ("user".equals(role)) break; // don't go past the user's message
        }
        return null;
    }

    private static String extractMessageContent(Map<?, ?> msg) {
        Object content = msg.get("content");
        if (content instanceof String s) return s;
        if (content instanceof List<?> contentList) {
            StringBuilder sb = new StringBuilder();
            for (Object item : contentList) {
                if (item instanceof Map<?, ?> itemMap && "text".equals(itemMap.get("type"))) {
                    Object text = itemMap.get("text");
                    if (text != null) sb.append(text);
                }
            }
            return sb.isEmpty() ? null : sb.toString();
        }
        return null;
    }

    private static String resolveAgentLabel(String routeCategory) {
        if (routeCategory == null) return null;
        return AGENT_LABELS.getOrDefault(routeCategory.trim(), routeCategory.trim());
    }
}
