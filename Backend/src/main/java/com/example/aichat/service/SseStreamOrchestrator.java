package com.example.aichat.service;

import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.exception.SessionExpiredException;
import com.example.aichat.model.SessionState;
import com.example.aichat.repository.SessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Single responsibility: manage SSE stream lifecycle (emitter creation, polling loop,
 * cleanup, and completion). Depends on ChatService for getResponse (SRP).
 */
@Component
public class SseStreamOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(SseStreamOrchestrator.class);

    private final CamundaChatService chatService;
    private final SessionRepository sessionStore;
    private final ScheduledExecutorService streamScheduler;
    private final Map<String, SseEmitter> activeEmitters = new ConcurrentHashMap<>();
    private final int pollingIntervalMs;
    private final double idleIntervalMultiplier;
    private final long emitterTimeoutMs;

    public SseStreamOrchestrator(
            @Lazy CamundaChatService chatService,
            SessionRepository sessionStore,
            ScheduledExecutorService streamScheduler,
            @Value("${app.polling.interval-ms:1000}") int pollingIntervalMs,
            @Value("${app.polling.idle-interval-multiplier:2.0}") double idleIntervalMultiplier,
            @Value("${app.sse.emitter-timeout-ms:600000}") long emitterTimeoutMs) {
        this.chatService = chatService;
        this.sessionStore = sessionStore;
        this.streamScheduler = streamScheduler;
        this.pollingIntervalMs = pollingIntervalMs;
        this.idleIntervalMultiplier = idleIntervalMultiplier;
        this.emitterTimeoutMs = emitterTimeoutMs;
    }

    /**
     * Opens an SSE stream for the session and schedules the response poll loop.
     * Replaces any existing stream for the same session.
     */
    public SseEmitter streamResponse(String sessionId) {
        sessionStore.getActiveSession(sessionId);

        SseEmitter emitter = new SseEmitter(emitterTimeoutMs);
        ScheduledFuture<?>[] futureHolder = new ScheduledFuture<?>[1];

        Runnable cleanup = () -> {
            if (futureHolder[0] != null) {
                futureHolder[0].cancel(false);
            }
            activeEmitters.remove(sessionId, emitter);
        };
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(t -> {
            log.warn("SSE stream error: sessionId={}, error={}", sessionId, t.getMessage());
            cleanup.run();
        });

        SseEmitter previous = activeEmitters.put(sessionId, emitter);
        if (previous != null) {
            previous.complete();
        }
        log.info("SSE stream opened: sessionId={}", sessionId);

        futureHolder[0] = streamScheduler.scheduleAtFixedRate(() -> {
            var sess = getSessionOrCompleteExpired(sessionId, emitter, futureHolder);
            if (sess == null) return;

            if (!sess.tryStartPoll()) return;
            try {
                ChatResponseDTO dto = chatService.getResponse(sessionId);

                if ("processing".equals(dto.status()) && sess.getConsecutiveEmptyPolls() > 10) {
                    int skipFactor = Math.max(1, (int) idleIntervalMultiplier);
                    if (sess.getConsecutiveEmptyPolls() % skipFactor != 0) {
                        return; // throttle SSE updates during idle periods
                    }
                }

                sendOrIgnoreIfCompleted(emitter, dto);

                if ("ready".equals(dto.status()) || "error".equals(dto.status())) {
                    cancelFutureAndComplete(futureHolder, emitter);
                }
            } catch (SessionExpiredException e) {
                sendSilently(emitter, new ChatResponseDTO("expired", "Session expired.", null));
                cancelFutureAndComplete(futureHolder, emitter);
            } catch (IOException e) {
                cancelFutureAndCompleteWithError(futureHolder, emitter, e);
            } catch (Exception e) {
                log.warn("SSE poll error for session {}: {}", sessionId, e.getMessage());
                cancelFutureAndCompleteWithError(futureHolder, emitter, e);
            } finally {
                sess.endPoll();
            }
        }, 0, pollingIntervalMs, TimeUnit.MILLISECONDS);

        return emitter;
    }

    private SessionState getSessionOrCompleteExpired(
            String sessionId, SseEmitter emitter, ScheduledFuture<?>[] futureHolder) {
        try {
            return sessionStore.getActiveSession(sessionId);
        } catch (SessionExpiredException e) {
            sendSilently(emitter, new ChatResponseDTO("expired", "Session expired.", null));
            cancelFutureAndComplete(futureHolder, emitter);
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private static void sendSilently(SseEmitter emitter, ChatResponseDTO dto) {
        try {
            emitter.send(SseEmitter.event().data(dto, MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException ignored) {
        }
    }

    private static void sendOrIgnoreIfCompleted(SseEmitter emitter, ChatResponseDTO dto) throws IOException {
        try {
            emitter.send(SseEmitter.event().data(dto, MediaType.APPLICATION_JSON));
        } catch (IllegalStateException ignored) {
        }
    }

    private static void cancelFutureAndComplete(ScheduledFuture<?>[] futureHolder, SseEmitter emitter) {
        if (futureHolder[0] != null) {
            futureHolder[0].cancel(false);
        }
        try {
            emitter.complete();
        } catch (IllegalStateException ignored) {
        }
    }

    private static void cancelFutureAndCompleteWithError(
            ScheduledFuture<?>[] futureHolder, SseEmitter emitter, Exception e) {
        if (futureHolder[0] != null) {
            futureHolder[0].cancel(false);
        }
        try {
            emitter.completeWithError(e);
        } catch (IllegalStateException ignored) {
        }
    }
}
