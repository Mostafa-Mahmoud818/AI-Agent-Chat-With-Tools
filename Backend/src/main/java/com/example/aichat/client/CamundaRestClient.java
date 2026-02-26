package com.example.aichat.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.util.*;

/**
 * Single point of access for Camunda Cluster REST API v2.
 * Eliminates duplicated HTTP call patterns across the service layer.
 */
@Component
public class CamundaRestClient {

    private static final Logger log = LoggerFactory.getLogger(CamundaRestClient.class);

    private final WebClient clusterClient;
    private final ObjectMapper objectMapper;

    public CamundaRestClient(
            @Qualifier("clusterWebClient") WebClient clusterClient,
            ObjectMapper objectMapper) {
        this.clusterClient = clusterClient;
        this.objectMapper = objectMapper;
    }

    public List<JsonNode> searchProcessInstances(Map<String, Object> filter, int size) {
        return searchProcessInstances(filter, size, null);
    }

    public List<JsonNode> searchProcessInstances(Map<String, Object> filter, int limit,
                                                 List<Map<String, String>> sort) {
        Map<String, Object> searchRequest = new HashMap<>();
        searchRequest.put("filter", filter);
        searchRequest.put("page", Map.of("limit", limit));
        if (sort != null) {
            searchRequest.put("sort", sort);
        }

        try {
            String responseBody = clusterClient.post()
                    .uri("/v2/process-instances/search")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(searchRequest)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            return parseItems(responseBody);
        } catch (WebClientResponseException e) {
            log.error("Process instance search failed ({}): {}", e.getStatusCode(), e.getResponseBodyAsString());
            throw e;
        }
    }

    public Map<String, Object> fetchProcessInstanceVariables(String processInstanceKey) {
        try {
            Map<String, Object> searchRequest = Map.of(
                    "filter", Map.of("processInstanceKey", processInstanceKey),
                    "page", Map.of("limit", 100)
            );

            String responseBody = clusterClient.post()
                    .uri("/v2/variables/search")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(searchRequest)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            List<JsonNode> items = parseItems(responseBody);
            Map<String, Object> variables = new HashMap<>();

            for (JsonNode varNode : items) {
                String varName = varNode.path("name").asText();
                String varValue = resolveVariableValue(varNode, varName);
                if (varValue == null) {
                    continue;
                }
                try {
                    JsonNode parsed = objectMapper.readTree(varValue);
                    variables.put(varName, objectMapper.convertValue(parsed, Object.class));
                } catch (Exception ex) {
                    variables.put(varName, varValue);
                }
            }

            log.debug("Fetched {} variable(s) for PI {}: {}", variables.size(), processInstanceKey, variables.keySet());
            return variables;

        } catch (WebClientResponseException e) {
            if (e.getStatusCode().value() == 404) {
                log.debug("Variables not found for PI {} (likely completed)", processInstanceKey);
                return Collections.emptyMap();
            }
            log.error("Error fetching variables for PI {}: {} - Response: {}",
                    processInstanceKey, e.getMessage(), e.getResponseBodyAsString());
            return Collections.emptyMap();
        } catch (Exception e) {
            log.error("Error fetching variables for PI {}: {}", processInstanceKey, e.getMessage());
            return Collections.emptyMap();
        }
    }

    /**
     * Resolves the string value for a variable node.
     * When the value is truncated, fetches the full value from the individual variable endpoint.
     */
    private String resolveVariableValue(JsonNode varNode, String varName) {
        boolean isTruncated = varNode.path("isTruncated").asBoolean(false);

        if (isTruncated) {
            String variableKey = varNode.path("variableKey").asText(null);
            if (variableKey == null || variableKey.isBlank()) {
                log.warn("Variable '{}' is truncated but has no variableKey; skipping full-value fetch", varName);
                return varNode.path("value").asText(null);
            }
            log.debug("Variable '{}' is truncated (key={}); fetching full value", varName, variableKey);
            return fetchFullVariableValue(variableKey, varName);
        }

        if (varNode.has("fullValue") && !varNode.path("fullValue").isNull()) {
            return varNode.path("fullValue").asText();
        }
        return varNode.path("value").asText(null);
    }

    /**
     * Fetches the complete (non-truncated) value of a variable via the individual variable endpoint.
     */
    private String fetchFullVariableValue(String variableKey, String varName) {
        try {
            String responseBody = clusterClient.get()
                    .uri("/v2/variables/{variableKey}", variableKey)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            JsonNode root = objectMapper.readTree(responseBody);
            if (root.has("fullValue") && !root.path("fullValue").isNull()) {
                return root.path("fullValue").asText();
            }
            return root.path("value").asText(null);
        } catch (WebClientResponseException e) {
            log.warn("Failed to fetch full value for variable '{}' (key={}): {} {}",
                    varName, variableKey, e.getStatusCode(), e.getResponseBodyAsString());
            return null;
        } catch (Exception e) {
            log.warn("Failed to fetch full value for variable '{}' (key={}): {}",
                    varName, variableKey, e.getMessage());
            return null;
        }
    }

    /**
     * Checks whether a process instance is in any of the given terminal states.
     */
    public boolean isProcessInstanceInState(String processInstanceKey, String... states) {
        try {
            for (String state : states) {
                Map<String, Object> filter = Map.of(
                        "processInstanceKey", processInstanceKey,
                        "state", state
                );
                if (!searchProcessInstances(filter, 1).isEmpty()) {
                    log.info("Process instance {} is {}", processInstanceKey, state);
                    return true;
                }
            }
            return false;
        } catch (Exception e) {
            log.warn("Failed to check PI state for {}: {}", processInstanceKey, e.getMessage());
            return false;
        }
    }

    private List<JsonNode> parseItems(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) {
            return Collections.emptyList();
        }

        try {
            JsonNode root = objectMapper.readTree(responseBody);
            JsonNode items = root.path("items");
            if (items.isArray()) {
                List<JsonNode> result = new ArrayList<>();
                items.forEach(result::add);
                return result;
            }
        } catch (Exception e) {
            log.error("Failed to parse response body: {}", e.getMessage());
        }

        return Collections.emptyList();
    }
}
