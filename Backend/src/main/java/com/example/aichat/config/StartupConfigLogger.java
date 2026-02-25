package com.example.aichat.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class StartupConfigLogger implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(StartupConfigLogger.class);

    @Value("${server.port:8080}")
    private String serverPort;

    @Value("${camunda.client.mode:NOT_SET}")
    private String camundaMode;

    @Value("${camunda.client.cloud.cluster-id:NOT_SET}")
    private String clusterId;

    @Value("${camunda.client.cloud.region:NOT_SET}")
    private String region;

    @Value("${camunda.client.auth.client-id:NOT_SET}")
    private String clientId;

    @Value("${camunda.client.auth.client-secret:NOT_SET}")
    private String clientSecret;

    @Value("${app.cors.allowed-origins:NOT_SET}")
    private String corsOrigins;

    @Value("${app.camunda.cluster-api-url:NOT_SET}")
    private String clusterApiUrl;

    @Value("${camunda.client.auth.token-url}")
    private String authTokenUrl;

    @Value("${app.camunda.process-id:NOT_SET}")
    private String processId;

    @Override
    public void run(String... args) {
        String maskedSecret = maskSecret(clientSecret);
        String maskedClientId = maskSecret(clientId);

        log.info("==========================================================");
        log.info("          APPLICATION CONFIGURATION DEBUG                  ");
        log.info("==========================================================");
        log.info("  Server Port        : {}", serverPort);
        log.info("  Camunda Mode       : {}", camundaMode);
        log.info("  Cluster ID         : {}", clusterId);
        log.info("  Region             : {}", region);
        log.info("  Client ID          : {}", maskedClientId);
        log.info("  Client Secret      : {}", maskedSecret);
        log.info("  Cluster API URL   : {}", clusterApiUrl);
        log.info("  Auth Token URL     : {}", authTokenUrl);
        log.info("  Process ID         : {}", processId);
        log.info("  CORS Origins       : {}", corsOrigins);
        log.info("==========================================================");
    }

    private String maskSecret(String value) {
        if (value == null || value.equals("NOT_SET") || value.length() < 8) {
            return value;
        }
        return value.substring(0, 4) + "****" + value.substring(value.length() - 4);
    }
}
