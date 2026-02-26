package com.example.aichat.service;

import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.model.SessionState;

/**
 * Abstraction for chat operations — the controller depends on this
 * interface rather than a concrete implementation (DIP).
 */
public interface ChatService {

    SessionState startSession(String inputText);

    ChatResponseDTO getResponse(String sessionId);

    void sendReply(String sessionId, String followUpInput);
}
