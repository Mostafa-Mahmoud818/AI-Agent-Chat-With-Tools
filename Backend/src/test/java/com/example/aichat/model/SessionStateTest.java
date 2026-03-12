package com.example.aichat.model;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

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
        String result = session.checkAndAcceptNewResponse("Hello!", "agent-1", 42);

        assertThat(result).isEqualTo("Hello!");
        assertThat(session.getLastResponseText()).isEqualTo("Hello!");
        assertThat(session.getLastHandledBy()).isEqualTo("agent-1");
    }

    @Test
    void checkAndAcceptNewResponse_returnsNullWhenNotAwaiting() {
        session.setAwaitingResponse(false);

        String result = session.checkAndAcceptNewResponse("Hello!", "agent-1", 42);

        assertThat(result).isNull();
    }

    @Test
    void checkAndAcceptNewResponse_returnsNullForBlankText() {
        assertThat(session.checkAndAcceptNewResponse("", "agent-1", 1)).isNull();
        assertThat(session.checkAndAcceptNewResponse("   ", "agent-1", 2)).isNull();
        assertThat(session.checkAndAcceptNewResponse(null, "agent-1", 3)).isNull();
    }

    @Test
    void checkAndAcceptNewResponse_setsAwaitingResponseFalseAfterAccepting() {
        assertThat(session.isAwaitingResponse()).isTrue();

        session.checkAndAcceptNewResponse("Hello!", "agent-1", 42);

        assertThat(session.isAwaitingResponse()).isFalse();
    }

    @Test
    void checkAndAcceptNewResponse_detectsNewResponseByHashWhenTextIdentical() {
        session.checkAndAcceptNewResponse("Same text", "agent-1", 100);
        assertThat(session.isAwaitingResponse()).isFalse();

        session.setAwaitingResponse(true);
        String result = session.checkAndAcceptNewResponse("Same text", "agent-1", 200);

        assertThat(result).isEqualTo("Same text");
        assertThat(session.isAwaitingResponse()).isFalse();
    }

    @Test
    void checkAndAcceptNewResponse_returnsNullWhenTextAndHashBothUnchanged() {
        session.checkAndAcceptNewResponse("Same text", "agent-1", 100);
        session.setAwaitingResponse(true);

        String result = session.checkAndAcceptNewResponse("Same text", "agent-1", 100);

        assertThat(result).isNull();
        assertThat(session.isAwaitingResponse()).isTrue();
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

    @Test
    void stalePollsIncrementOnUnchangedResponseWhileAwaiting() {
        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        session.setAwaitingResponse(true);

        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);

        assertThat(session.getConsecutiveStalePollsWhileAwaiting()).isEqualTo(3);
    }

    @Test
    void stalePollsResetWhenNewResponseAccepted() {
        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        session.setAwaitingResponse(true);

        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        assertThat(session.getConsecutiveStalePollsWhileAwaiting()).isEqualTo(2);

        session.checkAndAcceptNewResponse("New response", "agent-2", 99);
        assertThat(session.getConsecutiveStalePollsWhileAwaiting()).isZero();
    }

    @Test
    void stalePollsResetWhenAwaitingResponseSetTrue() {
        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        session.setAwaitingResponse(true);
        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        assertThat(session.getConsecutiveStalePollsWhileAwaiting()).isEqualTo(1);

        session.setAwaitingResponse(true);
        assertThat(session.getConsecutiveStalePollsWhileAwaiting()).isZero();
    }

    @Test
    void forceAcceptCurrentResponse_clearsAwaitingAndResetsStalePollsCounter() {
        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        session.setAwaitingResponse(true);
        session.checkAndAcceptNewResponse("Hello", "agent-1", 42);
        assertThat(session.isAwaitingResponse()).isTrue();
        assertThat(session.getConsecutiveStalePollsWhileAwaiting()).isEqualTo(1);

        session.forceAcceptCurrentResponse("Hello", "agent-1", 42);

        assertThat(session.isAwaitingResponse()).isFalse();
        assertThat(session.getConsecutiveStalePollsWhileAwaiting()).isZero();
        assertThat(session.getLastResponseText()).isEqualTo("Hello");
    }

    // -----------------------------------------------------------------------
    // tryStartPoll / endPoll
    // -----------------------------------------------------------------------

    @Test
    void tryStartPoll_firstCallReturnsTrue() {
        assertThat(session.tryStartPoll()).isTrue();
    }

    @Test
    void tryStartPoll_secondCallReturnsFalseWhilePollInProgress() {
        session.tryStartPoll();

        assertThat(session.tryStartPoll()).isFalse();
    }

    @Test
    void endPoll_allowsNextPollAfterRelease() {
        session.tryStartPoll();
        session.endPoll();

        assertThat(session.tryStartPoll()).isTrue();
    }

    @Test
    void tryStartPoll_onlyOneThreadWinsUnderConcurrency() throws InterruptedException {
        int threads = 20;
        var executor = Executors.newFixedThreadPool(threads);
        var latch = new CountDownLatch(1);
        var wins = new AtomicInteger(0);

        for (int i = 0; i < threads; i++) {
            executor.submit(() -> {
                try {
                    latch.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                if (session.tryStartPoll()) {
                    wins.incrementAndGet();
                }
            });
        }

        latch.countDown();
        executor.shutdown();
        executor.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS);

        assertThat(wins.get()).isEqualTo(1);
    }
}
