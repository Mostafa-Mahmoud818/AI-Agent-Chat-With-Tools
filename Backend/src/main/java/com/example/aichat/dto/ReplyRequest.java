package com.example.aichat.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ReplyRequest(
        @NotBlank(message = "followUpInput is required and must not be blank")
        @Size(max = 4000, message = "followUpInput must not exceed 4000 characters")
        String followUpInput
) {}
