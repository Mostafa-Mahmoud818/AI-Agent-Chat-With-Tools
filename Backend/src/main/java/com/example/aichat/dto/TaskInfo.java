package com.example.aichat.dto;

import java.util.Map;

public record TaskInfo(
                String userTaskKey,
                String name,
                String state,
                Map<String, Object> variables) {
}
