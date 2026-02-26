package com.example.aichat.dto;

public record StartChatRequest(String inputText) {

    public boolean isValid() {
        return inputText != null && !inputText.isBlank();
    }
}
