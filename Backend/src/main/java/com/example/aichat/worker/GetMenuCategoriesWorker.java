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
 * AI Agent tool worker — returns the catering menu categories from the menu API.
 * <p>
 * Called by the Catering Agent's ad-hoc subprocess when the AI model
 * decides to invoke the "Get Menu Categories" tool.
 */
@Component
public class GetMenuCategoriesWorker {

    private static final Logger log = LoggerFactory.getLogger(GetMenuCategoriesWorker.class);

    private static final String MENU_CATEGORIES_URL =
            "https://mock.apidog.com/m1/1228969-1225246-default/api/menu/categories";

    private final RestClient restClient = RestClient.create();

    @SuppressWarnings("unchecked")
    @JobWorker(type = "get-menu-categories-worker", autoComplete = true, fetchAllVariables = false)
    public Map<String, Object> getMenuCategories(final ActivatedJob job) {
        log.info("Fetching menu categories from API for job {}", job.getKey());

        Map<String, Object> response = restClient.get()
                .uri(MENU_CATEGORIES_URL)
                .retrieve()
                .body(Map.class);

        Map<String, Object> payload = (Map<String, Object>) response.get("payload");
        List<Map<String, Object>> menuItems = (List<Map<String, Object>>) payload.get("menuitems");

        log.info("Returning {} menu categories for job {}", menuItems.size(), job.getKey());
        return Map.of("toolCallResult", menuItems);
    }
}
