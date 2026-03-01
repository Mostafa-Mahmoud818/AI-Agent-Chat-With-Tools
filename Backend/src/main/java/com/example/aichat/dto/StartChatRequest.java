package com.example.aichat.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record StartChatRequest(
        @NotBlank(message = "inputText is required and must not be blank")
        @Size(max = 4000, message = "inputText must not exceed 4000 characters")
        String inputText
) {}
