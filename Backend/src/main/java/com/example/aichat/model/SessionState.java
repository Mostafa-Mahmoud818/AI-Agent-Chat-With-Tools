package com.example.aichat.model;

import java.time.Instant;

public class SessionState {

    private final String sessionId;
    private final String processInstanceKey;
    private final Instant createdAt;

    private String lastResponseText;
    private String lastHandledBy;
    private boolean awaitingResponse;
    private boolean expired;
    private int consecutiveEmptyPolls;
    private int consecutiveErrors;

    public SessionState(String sessionId, String processInstanceKey) {
        this.sessionId = sessionId;
        this.processInstanceKey = processInstanceKey;
        this.awaitingResponse = true;
        this.expired = false;
        this.consecutiveEmptyPolls = 0;
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
     * Atomically check for a new response and update state.
     * Returns the new responseText if detected, null if still waiting.
     */
    public synchronized String checkAndAcceptNewResponse(String currentResponseText, String handledBy) {
        if (currentResponseText == null || currentResponseText.isBlank()) {
            return null;
        }

        if (awaitingResponse) {
            if (lastResponseText == null || !lastResponseText.equals(currentResponseText)) {
                lastResponseText = currentResponseText;
                lastHandledBy = handledBy;
                awaitingResponse = false;
                consecutiveEmptyPolls = 0;
                return currentResponseText;
            }
        }

        return null;
    }
}
