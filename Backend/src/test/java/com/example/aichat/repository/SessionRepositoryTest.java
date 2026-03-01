package com.example.aichat.repository;

import com.example.aichat.exception.SessionExpiredException;
import com.example.aichat.exception.SessionNotFoundException;
import com.example.aichat.model.SessionState;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SessionRepositoryTest {

    private SessionRepository repository;

    @BeforeEach
    void setUp() {
        repository = new SessionRepository(30);
    }

    @Test
    void saveAndGetActiveSession_returnsSession() {
        SessionState session = new SessionState("sess-1", "pik-100");
        repository.save(session);

        SessionState result = repository.getActiveSession("sess-1");

        assertThat(result).isSameAs(session);
        assertThat(result.getSessionId()).isEqualTo("sess-1");
        assertThat(result.getProcessInstanceKey()).isEqualTo("pik-100");
    }

    @Test
    void getActiveSession_throwsSessionNotFoundForUnknownId() {
        assertThatThrownBy(() -> repository.getActiveSession("unknown-id"))
                .isInstanceOf(SessionNotFoundException.class)
                .hasMessageContaining("unknown-id");
    }

    @Test
    void getActiveSession_throwsSessionExpiredWhenMarkedExpired() {
        SessionState session = new SessionState("sess-2", "pik-200");
        session.setExpired(true);
        repository.save(session);

        assertThatThrownBy(() -> repository.getActiveSession("sess-2"))
                .isInstanceOf(SessionExpiredException.class)
                .hasMessageContaining("sess-2");
    }

    @Test
    void cleanupExpiredSessions_removesOldSessions() {
        // maxAgeMinutes=-1 makes cutoff 1 min in future, so all sessions are "expired"
        SessionRepository repo = new SessionRepository(-1);

        SessionState session = new SessionState("sess-3", "pik-300");
        repo.save(session);

        repo.cleanupExpiredSessions();

        assertThatThrownBy(() -> repo.getActiveSession("sess-3"))
                .isInstanceOf(SessionNotFoundException.class);
    }
}
