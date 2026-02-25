package com.example.aichat.controller;

import com.example.aichat.dto.*;
import com.example.aichat.service.CamundaService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);

    private final CamundaService camundaService;

    public ChatController(CamundaService camundaService) {
        this.camundaService = camundaService;
    }

    /**
     * Start a new chat conversation by creating a Camunda process instance.
     */
    @PostMapping("/start")
    public ResponseEntity<StartChatResponse> startChat(@RequestBody StartChatRequest request) {
        log.info("Starting new chat with input: {}", request.inputText());
        String processInstanceKey = camundaService.startProcess(request.inputText());
        return ResponseEntity.ok(new StartChatResponse(processInstanceKey));
    }

    /**
     * Search for active user tasks for a given process instance.
     * The frontend polls this endpoint to discover when the AI agent has finished
     * and a user task (feedback form or email approval) is ready.
     */
    @GetMapping("/{processInstanceKey}/tasks")
    public ResponseEntity<List<TaskInfo>> getTasks(@PathVariable String processInstanceKey) {
        List<TaskInfo> tasks = camundaService.searchTasks(processInstanceKey);
        return ResponseEntity.ok(tasks);
    }

    /**
     * Complete a user task with the provided variables.
     * Used for both the feedback form and the email approval form.
     */
    @PostMapping("/tasks/{userTaskKey}/complete")
    public ResponseEntity<Void> completeTask(
            @PathVariable String userTaskKey,
            @RequestBody CompleteTaskRequest request) {
        log.info("Completing task {} with variables: {}", userTaskKey, request.variables());
        camundaService.completeTask(userTaskKey, request.variables());
        return ResponseEntity.ok().build();
    }
}
