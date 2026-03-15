package com.example.aichat.camunda;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.util.*;

/**
 * Single point of access for Camunda Cluster REST API v2.
 * Eliminates duplicated HTTP call patterns across the service layer.
 */
@Component
public class CamundaRestClient {

    private static final Logger log = LoggerFactory.getLogger(CamundaRestClient.class);

    private final RestClient clusterClient;
    private final ObjectMapper objectMapper;

    public CamundaRestClient(
            @Qualifier("clusterRestClient") RestClient clusterClient,
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
                    .body(searchRequest)
                    .retrieve()
                    .body(String.class);

            return parseItems(responseBody);
        } catch (RestClientResponseException e) {
            log.error("Process instance search failed ({}): {}", e.getStatusCode(), e.getResponseBodyAsString());
            throw e;
        }
    }

    /**
     * Fetches the process variables needed to determine the current agent response.
     * Only "agent" and "routeCategory" are retrieved — targeted single-variable
     * queries avoid pulling the large agent context blob unnecessarily and prevent
     * spurious truncation-fetch round trips on every poll.
     */
    public Map<String, Object> fetchProcessInstanceVariables(String processInstanceKey) {
        Map<String, Object> variables = new HashMap<>();
        for (String varName : List.of("agent", "routeCategory")) {
            fetchSingleVariable(processInstanceKey, varName, variables);
        }
        if (log.isDebugEnabled()) {
            log.debug("Fetched {} variable(s) for PI {}: {}", variables.size(), processInstanceKey, variables.keySet());
        }
        return variables;
    }

    private void fetchSingleVariable(String processInstanceKey, String varName,
            Map<String, Object> target) {
        try {
            Map<String, Object> searchRequest = Map.of(
                    "filter", Map.of("processInstanceKey", processInstanceKey,
                            "name", varName),
                    "page", Map.of("limit", 1));

            String responseBody = clusterClient.post()
                    .uri("/v2/variables/search")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(searchRequest)
                    .retrieve()
                    .body(String.class);

            List<JsonNode> items = parseItems(responseBody);
            if (items.isEmpty()) {
                return;
            }

            JsonNode varNode = items.get(0);
            String varValue = resolveVariableValue(varNode, varName);
            if (varValue == null) {
                log.debug("Variable '{}' resolved to null for PI {}, skipping", varName, processInstanceKey);
                return;
            }
            try {
                JsonNode parsed = objectMapper.readTree(varValue);
                target.put(varName, objectMapper.convertValue(parsed, Object.class));
            } catch (Exception ex) {
                target.put(varName, varValue);
            }
        } catch (RestClientResponseException e) {
            if (e.getStatusCode().value() != 404) {
                log.error("Error fetching variable '{}' for PI {}: {} - Response: {}",
                        varName, processInstanceKey, e.getMessage(), e.getResponseBodyAsString());
            }
        } catch (Exception e) {
            log.error("Error fetching variable '{}' for PI {}: {}", varName, processInstanceKey, e.getMessage());
        }
    }

    /**
     * Resolves the string value for a variable node.
     * When the value is truncated, fetches the full value from the individual
     * variable endpoint.
     */
    private String resolveVariableValue(JsonNode varNode, String varName) {
        boolean isTruncated = varNode.path("isTruncated").asBoolean(false);

        if (isTruncated) {
            String variableKey = varNode.path("variableKey").asText(null);
            if (variableKey == null || variableKey.isBlank()) {
                log.warn("Variable '{}' is truncated but has no variableKey; skipping full-value fetch", varName);
                return varNode.path("value").asText(null);
            }
            return fetchFullVariableValue(variableKey, varName);
        }

        if (varNode.has("fullValue") && !varNode.path("fullValue").isNull()) {
            return varNode.path("fullValue").asText();
        }
        return varNode.path("value").asText(null);
    }

    /**
     * Fetches the complete (non-truncated) value of a variable via the individual
     * variable endpoint.
     */
    private String fetchFullVariableValue(String variableKey, String varName) {
        try {
            String responseBody = clusterClient.get()
                    .uri("/v2/variables/{variableKey}", variableKey)
                    .retrieve()
                    .body(String.class);

            JsonNode root = objectMapper.readTree(responseBody);
            if (root.has("fullValue") && !root.path("fullValue").isNull()) {
                return root.path("fullValue").asText();
            }
            return root.path("value").asText(null);
        } catch (RestClientResponseException e) {
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
                        "state", state);
                if (!searchProcessInstances(filter, 1).isEmpty()) {
                    return true;
                }
            }
            return false;
        } catch (Exception e) {
            log.warn("Failed to check PI state for {}: {}", processInstanceKey, e.getMessage());
            return false;
        }
    }

    /**
     * Returns true if the given flow node is currently ACTIVE within the process instance.
     * Used to detect when the process has reached the event-based gateway (agent completed).
     */
    public boolean isFlowNodeActive(String processInstanceKey, String flowNodeId) {
        try {
            Map<String, Object> searchRequest = Map.of(
                    "filter", Map.of(
                            "processInstanceKey", processInstanceKey,
                            "flowNodeId", flowNodeId,
                            "state", "ACTIVE"),
                    "page", Map.of("limit", 1));

            String responseBody = clusterClient.post()
                    .uri("/v2/flow-node-instances/search")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(searchRequest)
                    .retrieve()
                    .body(String.class);

            return !parseItems(responseBody).isEmpty();
        } catch (Exception e) {
            log.warn("Failed to check flow node state for PI {} / {}: {}", processInstanceKey, flowNodeId, e.getMessage());
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
