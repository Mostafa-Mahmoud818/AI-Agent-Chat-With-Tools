package com.example.aichat.config;

import io.netty.channel.ChannelOption;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ExchangeFilterFunction;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

@Configuration
public class ClusterWebClientConfig {

    private static final Logger log = LoggerFactory.getLogger(ClusterWebClientConfig.class);

    private final String clientId;
    private final String clientSecret;
    private final String authTokenUrl;
    private final String clusterApiUrl;

    private final WebClient authClient;
    private String cachedToken;
    private Instant tokenExpiry = Instant.MIN;

    public ClusterWebClientConfig(
            @Value("${camunda.client.auth.client-id}") String clientId,
            @Value("${camunda.client.auth.client-secret}") String clientSecret,
            @Value("${camunda.client.auth.token-url}") String authTokenUrl,
            @Value("${app.camunda.cluster-api-url}") String clusterApiUrl) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.authTokenUrl = authTokenUrl;
        this.clusterApiUrl = clusterApiUrl;

        HttpClient authHttpClient = HttpClient.create()
                .responseTimeout(Duration.ofSeconds(10))
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000);
        this.authClient = WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(authHttpClient))
                .build();
    }

    @Bean("clusterWebClient")
    public WebClient clusterWebClient(
            @Value("${app.camunda.cluster-api-timeout-seconds:30}") int apiTimeoutSeconds) {
        HttpClient httpClient = HttpClient.create()
                .responseTimeout(Duration.ofSeconds(apiTimeoutSeconds))
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000);

        return WebClient.builder()
                .baseUrl(clusterApiUrl)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
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

        String body = encodeFormData(Map.of(
                "grant_type", "client_credentials",
                "client_id", clientId,
                "client_secret", clientSecret,
                "audience", "zeebe.camunda.io"));

        Map<?, ?> response = authClient.post()
                .uri(authTokenUrl)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(Map.class)
                .block(Duration.ofSeconds(10));

        if (response == null || !response.containsKey("access_token") || !response.containsKey("expires_in")) {
            log.error("OAuth token response is null or missing required fields");
            if (cachedToken != null) {
                return cachedToken;
            }
            throw new IllegalStateException("Failed to obtain OAuth token from " + authTokenUrl);
        }

        cachedToken = (String) response.get("access_token");
        int expiresIn = ((Number) response.get("expires_in")).intValue();
        tokenExpiry = Instant.now().plusSeconds(expiresIn - 60);
        log.info("OAuth token acquired, expires in {}s", expiresIn);

        return cachedToken;
    }

    private static String encodeFormData(Map<String, String> data) {
        return data.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)
                        + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .reduce((a, b) -> a + "&" + b)
                .orElse("");
    }
}
