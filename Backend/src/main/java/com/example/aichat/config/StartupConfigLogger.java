package com.example.aichat.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class StartupConfigLogger implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(StartupConfigLogger.class);

    private final String serverPort;
    private final String camundaMode;
    private final String clusterId;
    private final String region;
    private final String clientId;
    private final String clientSecret;
    private final String corsOrigins;
    private final String clusterApiUrl;
    private final String authTokenUrl;
    private final String startMessage;
    private final String replyMessage;
    private final int messageTtl;
    private final int sessionMaxAge;

    public StartupConfigLogger(
            @Value("${server.port:8080}") String serverPort,
            @Value("${camunda.client.mode:NOT_SET}") String camundaMode,
            @Value("${camunda.client.cloud.cluster-id:NOT_SET}") String clusterId,
            @Value("${camunda.client.cloud.region:NOT_SET}") String region,
            @Value("${camunda.client.auth.client-id:NOT_SET}") String clientId,
            @Value("${camunda.client.auth.client-secret:NOT_SET}") String clientSecret,
            @Value("${app.cors.allowed-origins:NOT_SET}") String corsOrigins,
            @Value("${app.camunda.cluster-api-url:NOT_SET}") String clusterApiUrl,
            @Value("${camunda.client.auth.token-url}") String authTokenUrl,
            @Value("${app.camunda.messages.start:NOT_SET}") String startMessage,
            @Value("${app.camunda.messages.reply:NOT_SET}") String replyMessage,
            @Value("${app.camunda.messages.ttl-seconds:0}") int messageTtl,
            @Value("${app.session.max-age-minutes:0}") int sessionMaxAge) {
        this.serverPort = serverPort;
        this.camundaMode = camundaMode;
        this.clusterId = clusterId;
        this.region = region;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.corsOrigins = corsOrigins;
        this.clusterApiUrl = clusterApiUrl;
        this.authTokenUrl = authTokenUrl;
        this.startMessage = startMessage;
        this.replyMessage = replyMessage;
        this.messageTtl = messageTtl;
        this.sessionMaxAge = sessionMaxAge;
    }

    @Override
    public void run(String... args) {
        String maskedSecret = maskSecret(clientSecret);
        String maskedClientId = maskSecret(clientId);

        log.info("==========================================================");
        log.info("          APPLICATION CONFIGURATION                        ");
        log.info("==========================================================");
        log.info("  Server Port        : {}", serverPort);
        log.info("  Camunda Mode       : {}", camundaMode);
        log.info("  Cluster ID         : {}", clusterId);
        log.info("  Region             : {}", region);
        log.info("  Client ID          : {}", maskedClientId);
        log.info("  Client Secret      : {}", maskedSecret);
        log.info("  Cluster API URL    : {}", clusterApiUrl);
        log.info("  Auth Token URL     : {}", authTokenUrl);
        log.info("  Start Message      : {}", startMessage);
        log.info("  Reply Message      : {}", replyMessage);
        log.info("  Message TTL        : {}s", messageTtl);
        log.info("  Session Max Age    : {} min", sessionMaxAge);
        log.info("  CORS Origins       : {}", corsOrigins);
        log.info("==========================================================");
    }

    private String maskSecret(String value) {
        if (value == null || value.equals("NOT_SET")) {
            return value;
        }
        if (value.length() < 8) {
            return "****";
        }
        return value.substring(0, 4) + "****" + value.substring(value.length() - 4);
    }
}
