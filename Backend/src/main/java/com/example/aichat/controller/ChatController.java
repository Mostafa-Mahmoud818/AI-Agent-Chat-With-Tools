package com.example.aichat.controller;

import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.dto.ReplyRequest;
import com.example.aichat.dto.StartChatRequest;
import com.example.aichat.dto.StartChatResponse;
import com.example.aichat.exception.SessionExpiredException;
import com.example.aichat.exception.SessionNotFoundException;
import com.example.aichat.model.SessionState;
import com.example.aichat.service.CamundaChatService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Validated
@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);

    private final CamundaChatService chatService;

    public ChatController(CamundaChatService chatService) {
        this.chatService = chatService;
    }

    @PostMapping("/start")
    public ResponseEntity<StartChatResponse> startChat(@Valid @RequestBody StartChatRequest request) {
        SessionState session = chatService.startSession(request.inputText().trim());
        log.info("Chat started: sessionId={}, processInstanceKey={}", session.getSessionId(), session.getProcessInstanceKey());
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
        log.info("Reply sent: sessionId={}", sessionId);
        return ResponseEntity.ok().build();
    }

    @GetMapping(value = "/{sessionId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamResponse(
            @PathVariable @NotBlank(message = "sessionId is required") String sessionId) {
        try {
            return chatService.streamResponse(sessionId);
        } catch (SessionNotFoundException ex) {
            log.warn("SSE stream rejected: session not found, sessionId={}", sessionId);
            return closedEmitter(new ChatResponseDTO("error", ex.getMessage(), null));
        } catch (SessionExpiredException ex) {
            log.warn("SSE stream rejected: session expired, sessionId={}", sessionId);
            return closedEmitter(new ChatResponseDTO("expired", "Session expired.", null));
        }
    }

    private SseEmitter closedEmitter(ChatResponseDTO body) {
        SseEmitter emitter = new SseEmitter();
        try {
            emitter.send(SseEmitter.event().data(body, MediaType.APPLICATION_JSON));
        } catch (Exception ignored) {
        }
        emitter.complete();
        return emitter;
    }
}
