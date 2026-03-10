package com.example.aichat.service;

import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.model.SessionState;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Abstraction for chat operations — the controller depends on this
 * interface rather than a concrete implementation (DIP).
 */
public interface ChatService {

    SessionState startSession(String inputText);

    ChatResponseDTO getResponse(String sessionId);

    void sendReply(String sessionId, String followUpInput);

    /**
     * Opens a Server-Sent Events stream that pushes a ChatResponseDTO event
     * to the client as soon as the Camunda process produces a response.
     * The stream closes automatically once a terminal status is emitted.
     */
    SseEmitter streamResponse(String sessionId);
}
