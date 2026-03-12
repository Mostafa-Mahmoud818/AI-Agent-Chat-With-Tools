package com.example.aichat.exception;

import org.springframework.http.HttpStatus;

/**
 * Base exception for API errors with a stable error code and HTTP status.
 * Domain exceptions (session not found, expired, process start failed) extend this
 * so {@link GlobalExceptionHandler} can map them to a consistent JSON response.
 */
public abstract class ApiException extends RuntimeException {

    private final String errorCode;
    private final HttpStatus httpStatus;

    protected ApiException(String message, String errorCode, HttpStatus httpStatus) {
        super(message);
        this.errorCode = errorCode;
        this.httpStatus = httpStatus;
    }

    protected ApiException(String message, Throwable cause, String errorCode, HttpStatus httpStatus) {
        super(message, cause);
        this.errorCode = errorCode;
        this.httpStatus = httpStatus;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public HttpStatus getHttpStatus() {
        return httpStatus;
    }
}
