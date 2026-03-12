package com.example.aichat.exception;

import org.springframework.http.HttpStatus;

public class ProcessStartException extends ApiException {

    private static final String ERROR_CODE = "process_start_failed";
    private static final HttpStatus STATUS = HttpStatus.SERVICE_UNAVAILABLE;

    public ProcessStartException(String message) {
        super(message, ERROR_CODE, STATUS);
    }

    public ProcessStartException(String message, Throwable cause) {
        super(message, cause, ERROR_CODE, STATUS);
    }
}
