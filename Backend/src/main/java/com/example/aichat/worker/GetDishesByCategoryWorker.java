package com.example.aichat.worker;

import io.camunda.client.annotation.JobWorker;
import io.camunda.client.api.response.ActivatedJob;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;

/**
 * AI Agent tool worker — returns dishes for a given menu category from the menu API.
 * <p>
 * Called by the Catering Agent's ad-hoc subprocess when the AI model
 * decides to invoke the "Get Dishes by Category" tool.
 */
@Component
public class GetDishesByCategoryWorker {

    private static final Logger log = LoggerFactory.getLogger(GetDishesByCategoryWorker.class);

    private static final String DISHES_URL =
            "https://mock.apidog.com/m1/1228969-1225246-default/api/menu/dishes";

    private final RestClient restClient = RestClient.create();

    @SuppressWarnings("unchecked")
    @JobWorker(type = "get-dishes-by-category-worker", autoComplete = true, fetchAllVariables = false)
    public Map<String, Object> getDishesByCategory(final ActivatedJob job) {
        String categoryId = (String) job.getVariable("categoryId");
        log.info("Fetching dishes for category '{}' from API for job {}", categoryId, job.getKey());

        Map<String, Object> response = restClient.get()
                .uri(DISHES_URL + "?categoryId={categoryId}", categoryId)
                .retrieve()
                .body(Map.class);

        Map<String, Object> payload = (Map<String, Object>) response.get("payload");
        List<Map<String, Object>> menuItems = (List<Map<String, Object>>) payload.get("menuitems");

        log.info("Returning {} dishes for category '{}' for job {}", menuItems.size(), categoryId, job.getKey());
        return Map.of("toolCallResult", menuItems);
    }
}
