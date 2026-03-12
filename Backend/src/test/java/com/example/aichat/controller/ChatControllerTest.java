package com.example.aichat.controller;

import com.example.aichat.dto.ChatResponseDTO;
import com.example.aichat.model.SessionState;
import com.example.aichat.service.CamundaChatService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ChatController.class)
class ChatControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private CamundaChatService chatService;

    @Test
    void startChat_withValidBody_returns200() throws Exception {
        SessionState session = new SessionState("sess-1", "pik-100");
        when(chatService.startSession(anyString())).thenReturn(session);

        mockMvc.perform(post("/api/chat/start")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"inputText": "Hello AI"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value("sess-1"))
                .andExpect(jsonPath("$.processInstanceKey").value("pik-100"));
    }

    @Test
    void startChat_withBlankInputText_returns400() throws Exception {
        mockMvc.perform(post("/api/chat/start")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"inputText": "   "}
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void startChat_withNullBody_returns400() throws Exception {
        mockMvc.perform(post("/api/chat/start")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void getResponse_returns200WhenServiceReturnsProcessing() throws Exception {
        ChatResponseDTO dto = new ChatResponseDTO("processing", null, null);
        when(chatService.getResponse("sess-1")).thenReturn(dto);

        mockMvc.perform(get("/api/chat/{sessionId}/response", "sess-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("processing"));
    }

    @Test
    void sendReply_withValidBody_returns200() throws Exception {
        mockMvc.perform(post("/api/chat/{sessionId}/reply", "sess-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"followUpInput": "Tell me more"}
                                """))
                .andExpect(status().isOk());
    }

    @Test
    void sendReply_withBlankFollowUpInput_returns400() throws Exception {
        mockMvc.perform(post("/api/chat/{sessionId}/reply", "sess-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"followUpInput": "  "}
                                """))
                .andExpect(status().isBadRequest());
    }
}
