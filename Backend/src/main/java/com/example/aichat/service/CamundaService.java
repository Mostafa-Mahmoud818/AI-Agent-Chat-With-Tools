package com.example.aichat.service;

import com.example.aichat.dto.TaskInfo;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.camunda.client.CamundaClient;
import io.camunda.client.api.response.ProcessInstanceEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.util.*;

@Service
public class CamundaService {

    private static final Logger log = LoggerFactory.getLogger(CamundaService.class);

    private final CamundaClient camundaClient;
    private final WebClient clusterClient;
    private final ObjectMapper objectMapper;

    @Value("${app.camunda.process-id}")
    private String processId;

    public CamundaService(
            CamundaClient camundaClient,
            @Qualifier("clusterWebClient") WebClient clusterClient,
            ObjectMapper objectMapper) {
        this.camundaClient = camundaClient;
        this.clusterClient = clusterClient;
        this.objectMapper = objectMapper;
    }

    /**
     * Starts a new process instance with the given input text.
     * Returns the process instance key as a String to prevent JS precision loss.
     */
    public String startProcess(String inputText) {
        Map<String, Object> variables = new HashMap<>();
        variables.put("inputText", inputText);

        ProcessInstanceEvent event = camundaClient
                .newCreateInstanceCommand()
                .bpmnProcessId(processId)
                .latestVersion()
                .variables(variables)
                .send()
                .join();

        log.info("Started process instance: {}", event.getProcessInstanceKey());
        return String.valueOf(event.getProcessInstanceKey());
    }

    /**
     * Searches for active user tasks for a given process instance key
     * using the Camunda Orchestration Cluster REST API v2.
     */
    public List<TaskInfo> searchTasks(String processInstanceKey) {
        try {
            // Build v2 search request - processInstanceKey must be string per Orchestration Cluster API
            Map<String, Object> filter = new HashMap<>();
            filter.put("state", "CREATED");
            filter.put("processInstanceKey", processInstanceKey);

            Map<String, Object> searchRequest = Map.of("filter", filter);

            String responseBody = clusterClient.post()
                    .uri("/v2/user-tasks/search")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(searchRequest)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            if (responseBody == null || responseBody.isBlank()) {
                return Collections.emptyList();
            }

            JsonNode root = objectMapper.readTree(responseBody);
            JsonNode items = root.path("items");

            if (!items.isArray() || items.isEmpty()) {
                return Collections.emptyList();
            }

            List<TaskInfo> tasks = new ArrayList<>();

            for (JsonNode taskNode : items) {
                String userTaskKey = taskNode.has("userTaskKey") && taskNode.path("userTaskKey").isTextual()
                        ? taskNode.path("userTaskKey").asText()
                        : String.valueOf(taskNode.path("userTaskKey").asLong());
                String name = taskNode.path("name").asText();
                String state = taskNode.path("state").asText();

                // Fetch variables for this task
                Map<String, Object> variables = fetchTaskVariables(userTaskKey);

                tasks.add(new TaskInfo(userTaskKey, name, state, variables));
            }

            log.debug("Found {} tasks for process instance {}", tasks.size(), processInstanceKey);
            return tasks;

        } catch (WebClientResponseException e) {
            log.error("Error searching tasks for process instance {}: {} - Response: {}", processInstanceKey, e.getMessage(), e.getResponseBodyAsString());
            return Collections.emptyList();
        } catch (Exception e) {
            log.error("Error searching tasks for process instance {}: {}", processInstanceKey, e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Fetches variables for a specific user task using the v2 API.
     */
    public Map<String, Object> fetchTaskVariables(String userTaskKey) {
        try {
            // v2: POST /v2/user-tasks/{userTaskKey}/variables/search with empty body
            String responseBody = clusterClient.post()
                    .uri("/v2/user-tasks/{userTaskKey}/variables/search", userTaskKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(Map.of())
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            if (responseBody == null || responseBody.isBlank()) {
                return Collections.emptyMap();
            }

            JsonNode root = objectMapper.readTree(responseBody);
            JsonNode items = root.path("items");

            if (!items.isArray()) {
                return Collections.emptyMap();
            }

            Map<String, Object> variables = new HashMap<>();

            for (JsonNode varNode : items) {
                String varName = varNode.path("name").asText();
                // v2 returns "value" as the variable value (may be truncated)
                // "fullValue" contains the complete value if truncated
                String varValue = varNode.has("fullValue") && !varNode.path("fullValue").isNull()
                        ? varNode.path("fullValue").asText()
                        : varNode.path("value").asText();

                // Try to parse JSON values
                try {
                    JsonNode parsed = objectMapper.readTree(varValue);
                    variables.put(varName, objectMapper.convertValue(parsed, Object.class));
                } catch (Exception ex) {
                    variables.put(varName, varValue);
                }
            }

            return variables;

        } catch (Exception e) {
            log.error("Error fetching variables for task {}: {}", userTaskKey, e.getMessage());
            return Collections.emptyMap();
        }
    }

    /**
     * Completes a user task with the given variables
     * using the Orchestration Cluster REST API v2.
     * v2 expects: POST /v2/user-tasks/{userTaskKey}/completion
     * with body: { "variables": { "key": value, ... } }
     * Returns 204 No Content on success.
     */
    public void completeTask(String userTaskKey, Map<String, Object> variables) {
        try {
            Map<String, Object> completeRequest = new HashMap<>();
            if (variables != null && !variables.isEmpty()) {
                completeRequest.put("variables", variables);
            }

            clusterClient.post()
                    .uri("/v2/user-tasks/{userTaskKey}/completion", userTaskKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(completeRequest)
                    .retrieve()
                    .toBodilessEntity()
                    .block();

            log.info("Completed task: {}", userTaskKey);

        } catch (Exception e) {
            log.error("Error completing task {}: {}", userTaskKey, e.getMessage());
            throw new RuntimeException("Failed to complete task: " + e.getMessage(), e);
        }
    }
}
