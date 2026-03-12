package com.example.aichat.exception;

import org.springframework.http.HttpStatus;

public class SessionNotFoundException extends ApiException {

    private static final String ERROR_CODE = "session_not_found";
    private static final HttpStatus STATUS = HttpStatus.NOT_FOUND;

    public SessionNotFoundException(String sessionId) {
        super("Unknown session: " + sessionId, ERROR_CODE, STATUS);
    }
}
