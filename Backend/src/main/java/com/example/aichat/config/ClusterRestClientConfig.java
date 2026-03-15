package com.example.aichat.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

@Configuration
public class ClusterRestClientConfig {

    private static final Logger log = LoggerFactory.getLogger(ClusterRestClientConfig.class);

    private final String clientId;
    private final String clientSecret;
    private final String authTokenUrl;
    private final String clusterApiUrl;

    private String cachedToken;
    private Instant tokenExpiry = Instant.MIN;

    public ClusterRestClientConfig(
            @Value("${camunda.client.auth.client-id}") String clientId,
            @Value("${camunda.client.auth.client-secret}") String clientSecret,
            @Value("${camunda.client.auth.token-url}") String authTokenUrl,
            @Value("${app.camunda.cluster-api-url}") String clusterApiUrl) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.authTokenUrl = authTokenUrl;
        this.clusterApiUrl = clusterApiUrl;
    }

    @Bean("clusterRestClient")
    public RestClient clusterRestClient(
            @Value("${app.camunda.cluster-api-timeout-seconds:30}") int apiTimeoutSeconds) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();

        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofSeconds(apiTimeoutSeconds));

        return RestClient.builder()
                .baseUrl(clusterApiUrl)
                .requestFactory(factory)
                .requestInterceptor((request, body, execution) -> {
                    request.getHeaders().setBearerAuth(getAccessToken());
                    return execution.execute(request, body);
                })
                .build();
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

        HttpClient authHttpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
        JdkClientHttpRequestFactory authFactory = new JdkClientHttpRequestFactory(authHttpClient);
        authFactory.setReadTimeout(Duration.ofSeconds(10));

        Map<?, ?> response = RestClient.builder()
                .requestFactory(authFactory)
                .build()
                .post()
                .uri(authTokenUrl)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(body)
                .retrieve()
                .body(Map.class);

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
