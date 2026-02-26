package com.example.aichat.dto;

public record ReplyRequest(String followUpInput) {

    public boolean isValid() {
        return followUpInput != null && !followUpInput.isBlank();
    }
}
