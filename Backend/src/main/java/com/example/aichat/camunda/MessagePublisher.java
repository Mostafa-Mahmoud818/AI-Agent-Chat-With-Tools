package com.example.aichat.camunda;

import io.camunda.client.CamundaClient;
import io.camunda.client.api.response.CorrelateMessageResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Wraps Zeebe message operations so the publish/correlate patterns live in one
 * place.
 * <p>
 * publish() - buffered fire-and-forget; used for intermediate catch events
 * (replies)
 * correlate() - strongly-consistent; used for message start events; returns
 * processInstanceKey
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

    /**
     * Correlates a message to an existing subscription and returns the key of the
     * first
     * process instance the message was correlated with. Unlike publish(), this call
     * is
     * strongly consistent and non-buffered -- if no subscription exists (e.g.
     * process not
     * deployed) it fails immediately with a clear error rather than timing out.
     */
    public long correlate(String messageName, String correlationKey, Map<String, Object> variables) {
        CorrelateMessageResponse response = camundaClient.newCorrelateMessageCommand()
                .messageName(messageName)
                .correlationKey(correlationKey)
                .variables(variables)
                .send()
                .join(30, TimeUnit.SECONDS);
        return response.getProcessInstanceKey();
    }
}
