package com.example.aichat.service;

import io.camunda.client.CamundaClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;

/**
 * Wraps Zeebe message publishing, so the publish-message-with-TTL
 * pattern lives in exactly one place.
 */
@Component
public class MessagePublisher {

    private static final Logger log = LoggerFactory.getLogger(MessagePublisher.class);
    private static final Duration DEFAULT_TTL = Duration.ofSeconds(30);

    private final CamundaClient camundaClient;

    public MessagePublisher(CamundaClient camundaClient) {
        this.camundaClient = camundaClient;
    }

    public void publish(String messageName, String correlationKey, Map<String, Object> variables) {
        log.info("Publishing message '{}' with correlationKey '{}'", messageName, correlationKey);
        camundaClient.newPublishMessageCommand()
                .messageName(messageName)
                .correlationKey(correlationKey)
                .variables(variables)
                .timeToLive(DEFAULT_TTL)
                .send()
                .join();
    }
}
