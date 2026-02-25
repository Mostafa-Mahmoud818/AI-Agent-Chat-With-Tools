package com.example.aichat.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ExchangeFilterFunction;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Instant;
import java.util.Map;

/**
 * Configures an OAuth2-authenticated WebClient for the Camunda
 * Orchestration Cluster REST API (v2).
 * Automatically fetches and caches access tokens using client_credentials
 * grant.
 */
@Configuration
public class TasklistClientConfig {

    private static final Logger log = LoggerFactory.getLogger(TasklistClientConfig.class);

    @Value("${camunda.client.auth.client-id}")
    private String clientId;

    @Value("${camunda.client.auth.client-secret}")
    private String clientSecret;

    @Value("${camunda.client.auth.token-url}")
    private String authTokenUrl;

    @Value("${app.camunda.cluster-api-url}")
    private String clusterApiUrl;

    private String cachedToken;
    private Instant tokenExpiry = Instant.MIN;

    @Bean("clusterWebClient")
    public WebClient clusterWebClient() {
        log.info("Configuring Cluster API WebClient with base URL: {}", clusterApiUrl);
        return WebClient.builder()
                .baseUrl(clusterApiUrl)
                .filter(oauthFilter())
                .build();
    }

    private ExchangeFilterFunction oauthFilter() {
        return (request, next) -> {
            String token = getAccessToken();
            ClientRequest authorized = ClientRequest.from(request)
                    .header("Authorization", "Bearer " + token)
                    .build();
            return next.exchange(authorized);
        };
    }

    private synchronized String getAccessToken() {
        if (cachedToken != null && Instant.now().isBefore(tokenExpiry)) {
            return cachedToken;
        }

        log.info("Fetching new OAuth token from {}", authTokenUrl);

        // Fetch a new token from Camunda's OAuth endpoint
        WebClient authClient = WebClient.create();

        Map<String, String> formData = Map.of(
                "grant_type", "client_credentials",
                "client_id", clientId,
                "client_secret", clientSecret,
                "audience", "zeebe.camunda.io");

        String body = formData.entrySet().stream()
                .map(e -> e.getKey() + "=" + e.getValue())
                .reduce((a, b) -> a + "&" + b)
                .orElse("");

        Map<?, ?> response = authClient.post()
                .uri(authTokenUrl)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(Map.class)
                .block();

        if (response != null) {
            cachedToken = (String) response.get("access_token");
            int expiresIn = (Integer) response.get("expires_in");
            tokenExpiry = Instant.now().plusSeconds(expiresIn - 60); // refresh 60s early
            log.info("OAuth token acquired, expires in {}s", expiresIn);
        }

        return cachedToken;
    }
}
