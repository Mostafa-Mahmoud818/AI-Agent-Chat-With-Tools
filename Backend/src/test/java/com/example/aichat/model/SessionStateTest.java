package com.example.aichat.model;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SessionStateTest {

    private SessionState session;

    @BeforeEach
    void setUp() {
        session = new SessionState("sess-1", "pik-100");
    }

    @Test
    void constructorSetsCorrectDefaults() {
        assertThat(session.getSessionId()).isEqualTo("sess-1");
        assertThat(session.getProcessInstanceKey()).isEqualTo("pik-100");
        assertThat(session.isAwaitingResponse()).isTrue();
        assertThat(session.isExpired()).isFalse();
        assertThat(session.getConsecutiveEmptyPolls()).isZero();
        assertThat(session.getConsecutiveErrors()).isZero();
        assertThat(session.getCreatedAt()).isNotNull();
    }

    @Test
    void checkAndAcceptNewResponse_returnsTextWhenAwaitingAndNewText() {
        String result = session.checkAndAcceptNewResponse("Hello!", "agent-1");

        assertThat(result).isEqualTo("Hello!");
        assertThat(session.getLastResponseText()).isEqualTo("Hello!");
        assertThat(session.getLastHandledBy()).isEqualTo("agent-1");
    }

    @Test
    void checkAndAcceptNewResponse_returnsNullWhenNotAwaiting() {
        session.setAwaitingResponse(false);

        String result = session.checkAndAcceptNewResponse("Hello!", "agent-1");

        assertThat(result).isNull();
    }

    @Test
    void checkAndAcceptNewResponse_returnsNullForBlankText() {
        assertThat(session.checkAndAcceptNewResponse("", "agent-1")).isNull();
        assertThat(session.checkAndAcceptNewResponse("   ", "agent-1")).isNull();
        assertThat(session.checkAndAcceptNewResponse(null, "agent-1")).isNull();
    }

    @Test
    void checkAndAcceptNewResponse_setsAwaitingResponseFalseAfterAccepting() {
        assertThat(session.isAwaitingResponse()).isTrue();

        session.checkAndAcceptNewResponse("Hello!", "agent-1");

        assertThat(session.isAwaitingResponse()).isFalse();
    }

    @Test
    void incrementAndResetConsecutiveErrors() {
        assertThat(session.getConsecutiveErrors()).isZero();

        session.incrementConsecutiveErrors();
        session.incrementConsecutiveErrors();
        assertThat(session.getConsecutiveErrors()).isEqualTo(2);

        session.resetConsecutiveErrors();
        assertThat(session.getConsecutiveErrors()).isZero();
    }

    @Test
    void incrementAndResetEmptyPolls() {
        assertThat(session.getConsecutiveEmptyPolls()).isZero();

        session.incrementEmptyPolls();
        session.incrementEmptyPolls();
        session.incrementEmptyPolls();
        assertThat(session.getConsecutiveEmptyPolls()).isEqualTo(3);

        session.resetEmptyPolls();
        assertThat(session.getConsecutiveEmptyPolls()).isZero();
    }

    @Test
    void setAwaitingResponseTrue_resetsEmptyPolls() {
        session.incrementEmptyPolls();
        session.incrementEmptyPolls();
        assertThat(session.getConsecutiveEmptyPolls()).isEqualTo(2);

        session.setAwaitingResponse(true);

        assertThat(session.getConsecutiveEmptyPolls()).isZero();
    }
}
