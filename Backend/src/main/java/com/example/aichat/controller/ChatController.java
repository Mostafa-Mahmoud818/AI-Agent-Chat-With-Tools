package com.example.aichat.controller;

import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.dto.ReplyRequest;
import com.example.aichat.dto.StartChatRequest;
import com.example.aichat.dto.StartChatResponse;
import com.example.aichat.model.SessionState;
import com.example.aichat.service.ChatService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    @PostMapping("/start")
    public ResponseEntity<StartChatResponse> startChat(@RequestBody StartChatRequest request) {
        requireValid(request == null || !request.isValid(),
                "inputText is required and must not be blank");
        log.info("Starting new chat session (input length: {})", request.inputText().length());
        SessionState session = chatService.startSession(request.inputText());
        return ResponseEntity.ok(new StartChatResponse(session.getSessionId(), session.getProcessInstanceKey()));
    }

    @GetMapping("/{sessionId}/response")
    public ResponseEntity<ChatResponseDTO> getResponse(@PathVariable String sessionId) {
        requireNonBlank(sessionId, "sessionId");
        return ResponseEntity.ok(chatService.getResponse(sessionId));
    }

    @PostMapping("/{sessionId}/reply")
    public ResponseEntity<Void> sendReply(
            @PathVariable String sessionId,
            @RequestBody ReplyRequest request) {
        requireNonBlank(sessionId, "sessionId");
        requireValid(request == null || !request.isValid(),
                "followUpInput is required and must not be blank");
        log.info("Sending reply for session {} (input length: {})", sessionId, request.followUpInput().length());
        chatService.sendReply(sessionId, request.followUpInput());
        return ResponseEntity.ok().build();
    }

    private void requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is required");
        }
    }

    private void requireValid(boolean invalid, String message) {
        if (invalid) {
            throw new IllegalArgumentException(message);
        }
    }
}
