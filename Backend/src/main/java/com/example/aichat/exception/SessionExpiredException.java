package com.example.aichat.exception;

import org.springframework.http.HttpStatus;

public class SessionExpiredException extends ApiException {

    private static final String ERROR_CODE = "session_expired";
    private static final HttpStatus STATUS = HttpStatus.GONE;

    public SessionExpiredException(String sessionId) {
        super("Session has expired (process completed or timed out): " + sessionId, ERROR_CODE, STATUS);
    }
}
