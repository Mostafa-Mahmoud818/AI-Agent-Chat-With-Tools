package com.example.aichat.exception;

public class SessionExpiredException extends RuntimeException {

    public SessionExpiredException(String sessionId) {
        super("Session has expired (process completed or timed out): " + sessionId);
    }
}
