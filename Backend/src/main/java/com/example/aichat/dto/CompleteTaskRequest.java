package com.example.aichat.dto;

import java.util.Map;

public record CompleteTaskRequest(Map<String, Object> variables) {
}
