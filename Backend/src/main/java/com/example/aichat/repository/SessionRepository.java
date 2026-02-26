package com.example.aichat.repository;

import com.example.aichat.exception.SessionExpiredException;
import com.example.aichat.exception.SessionNotFoundException;
import com.example.aichat.model.SessionState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Repository;

import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory session store with automatic expiry cleanup.
 * Consolidates the session guard pattern (existence + expiry check)
 */
@Repository
public class SessionRepository {

    private static final Logger log = LoggerFactory.getLogger(SessionRepository.class);
    private static final Duration SESSION_MAX_AGE = Duration.ofMinutes(35);

    private final Map<String, SessionState> sessions = new ConcurrentHashMap<>();

    public void save(SessionState session) {
        sessions.put(session.getSessionId(), session);
    }

    /**
     * Returns the session if it exists and is not expired.
     * Throws the appropriate exception otherwise
     */
    public SessionState getActiveSession(String sessionId) {
        SessionState session = sessions.get(sessionId);
        if (session == null) {
            throw new SessionNotFoundException(sessionId);
        }
        if (session.isExpired()) {
            throw new SessionExpiredException(sessionId);
        }
        return session;
    }

    @Scheduled(fixedDelay = 300_000)
    public void cleanupExpiredSessions() {
        Instant cutoff = Instant.now().minus(SESSION_MAX_AGE);
        int removed = 0;
        Iterator<Map.Entry<String, SessionState>> it = sessions.entrySet().iterator();
        while (it.hasNext()) {
            if (it.next().getValue().getCreatedAt().isBefore(cutoff)) {
                it.remove();
                removed++;
            }
        }
        if (removed > 0) {
            log.info("Cleaned up {} expired sessions, {} remaining", removed, sessions.size());
        }
    }
}
