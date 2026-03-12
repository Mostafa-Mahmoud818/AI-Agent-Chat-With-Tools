package com.example.aichat.model;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;

public class SessionState {

    private final String sessionId;
    private final String processInstanceKey;
    private final Instant createdAt;
    private final AtomicBoolean pollInProgress = new AtomicBoolean(false);

    private String lastResponseText;
    private String lastHandledBy;
    private int lastAgentHash;
    private boolean awaitingResponse;
    private boolean expired;
    private int consecutiveEmptyPolls;
    private int consecutiveStalePollsWhileAwaiting;
    private int consecutiveErrors;

    public SessionState(String sessionId, String processInstanceKey) {
        this.sessionId = sessionId;
        this.processInstanceKey = processInstanceKey;
        this.awaitingResponse = true;
        this.expired = false;
        this.consecutiveEmptyPolls = 0;
        this.consecutiveStalePollsWhileAwaiting = 0;
        this.consecutiveErrors = 0;
        this.createdAt = Instant.now();
    }

    public String getSessionId() {
        return sessionId;
    }

    public String getProcessInstanceKey() {
        return processInstanceKey;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public synchronized String getLastResponseText() {
        return lastResponseText;
    }

    public synchronized void setLastResponseText(String lastResponseText) {
        this.lastResponseText = lastResponseText;
    }

    public synchronized String getLastHandledBy() {
        return lastHandledBy;
    }

    public synchronized void setLastHandledBy(String lastHandledBy) {
        this.lastHandledBy = lastHandledBy;
    }

    public synchronized boolean isAwaitingResponse() {
        return awaitingResponse;
    }

    public synchronized void setAwaitingResponse(boolean awaitingResponse) {
        this.awaitingResponse = awaitingResponse;
        if (awaitingResponse) {
            this.consecutiveEmptyPolls = 0;
            this.consecutiveStalePollsWhileAwaiting = 0;
        }
    }

    public synchronized boolean isExpired() {
        return expired;
    }

    public synchronized void setExpired(boolean expired) {
        this.expired = expired;
    }

    public synchronized int getConsecutiveEmptyPolls() {
        return consecutiveEmptyPolls;
    }

    public synchronized void incrementEmptyPolls() {
        this.consecutiveEmptyPolls++;
    }

    public synchronized void resetEmptyPolls() {
        this.consecutiveEmptyPolls = 0;
    }

    /**
     * Force-accept the current response when external checks (e.g. flow-node state)
     * confirm the agent has completed, even though text/hash didn't change.
     */
    public synchronized void forceAcceptCurrentResponse(String responseText, String handledBy, int agentHash) {
        this.lastResponseText = responseText;
        this.lastHandledBy = handledBy;
        this.lastAgentHash = agentHash;
        this.awaitingResponse = false;
        this.consecutiveEmptyPolls = 0;
        this.consecutiveStalePollsWhileAwaiting = 0;
    }

    public synchronized int getConsecutiveStalePollsWhileAwaiting() {
        return consecutiveStalePollsWhileAwaiting;
    }

    public synchronized void resetStalePollsWhileAwaiting() {
        this.consecutiveStalePollsWhileAwaiting = 0;
    }

    public synchronized int getConsecutiveErrors() {
        return consecutiveErrors;
    }

    public synchronized void incrementConsecutiveErrors() {
        this.consecutiveErrors++;
    }

    public synchronized void resetConsecutiveErrors() {
        this.consecutiveErrors = 0;
    }

    /**
     * Atomically claims the right to run a poll for this session.
     * Returns true if the caller may proceed; false if a poll is already in flight.
     * Always call {@link #endPoll()} in a finally block after a successful claim.
     */
    public boolean tryStartPoll() {
        return pollInProgress.compareAndSet(false, true);
    }

    /** Releases the poll claim acquired by {@link #tryStartPoll()}. */
    public void endPoll() {
        pollInProgress.set(false);
    }

    /**
     * Atomically check for a new response and update state.
     * Returns the new responseText if detected, null if still waiting.
     *
     * Uses both text comparison and an agent-object hash so that a new response
     * is detected even when the response text is identical across rounds (the
     * agent context changes each round, producing a different hash).
     */
    public synchronized String checkAndAcceptNewResponse(String currentResponseText, String handledBy,
            int agentHash) {
        if (currentResponseText == null || currentResponseText.isBlank()) {
            return null;
        }

        if (awaitingResponse) {
            boolean textChanged = lastResponseText == null || !lastResponseText.equals(currentResponseText);
            boolean agentChanged = agentHash != lastAgentHash;
            if (textChanged || agentChanged) {
                lastResponseText = currentResponseText;
                lastHandledBy = handledBy;
                lastAgentHash = agentHash;
                awaitingResponse = false;
                consecutiveEmptyPolls = 0;
                consecutiveStalePollsWhileAwaiting = 0;
                return currentResponseText;
            }
            consecutiveStalePollsWhileAwaiting++;
        }

        return null;
    }
}
