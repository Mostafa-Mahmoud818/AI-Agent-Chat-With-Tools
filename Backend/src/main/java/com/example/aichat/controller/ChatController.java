package com.example.aichat.controller;

import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.dto.ReplyRequest;
import com.example.aichat.dto.StartChatRequest;
import com.example.aichat.dto.StartChatResponse;
import com.example.aichat.model.SessionState;
import com.example.aichat.service.ChatService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Validated
@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    @PostMapping("/start")
    public ResponseEntity<StartChatResponse> startChat(@Valid @RequestBody StartChatRequest request) {
        SessionState session = chatService.startSession(request.inputText().trim());
        return ResponseEntity.ok(new StartChatResponse(session.getSessionId(), session.getProcessInstanceKey()));
    }

    @GetMapping("/{sessionId}/response")
    public ResponseEntity<ChatResponseDTO> getResponse(
            @PathVariable @NotBlank(message = "sessionId is required") String sessionId) {
        return ResponseEntity.ok(chatService.getResponse(sessionId));
    }

    @PostMapping("/{sessionId}/reply")
    public ResponseEntity<Void> sendReply(
            @PathVariable @NotBlank(message = "sessionId is required") String sessionId,
            @Valid @RequestBody ReplyRequest request) {
        chatService.sendReply(sessionId, request.followUpInput().trim());
        return ResponseEntity.ok().build();
    }
}
