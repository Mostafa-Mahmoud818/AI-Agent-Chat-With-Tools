package com.example.aichat.service;

import io.camunda.client.CamundaClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Wraps Zeebe message publishing, so the publish-message-with-TTL
 * pattern lives in exactly one place.
 */
@Component
public class MessagePublisher {

    private final CamundaClient camundaClient;
    private final Duration ttl;

    public MessagePublisher(
            CamundaClient camundaClient,
            @Value("${app.camunda.messages.ttl-seconds}") int ttlSeconds) {
        this.camundaClient = camundaClient;
        this.ttl = Duration.ofSeconds(ttlSeconds);
    }

    public void publish(String messageName, String correlationKey, Map<String, Object> variables) {
        camundaClient.newPublishMessageCommand()
                .messageName(messageName)
                .correlationKey(correlationKey)
                .variables(variables)
                .timeToLive(ttl)
                .send()
                .join(30, TimeUnit.SECONDS);
    }
}
