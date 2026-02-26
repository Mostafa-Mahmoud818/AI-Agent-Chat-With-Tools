package com.example.aichat.exception;

public class SessionNotFoundException extends RuntimeException {

    public SessionNotFoundException(String sessionId) {
        super("Unknown session: " + sessionId);
    }
}
