package com.example.aichat.worker;

import io.camunda.client.annotation.JobWorker;
import io.camunda.client.api.response.ActivatedJob;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * AI Agent tool worker — returns the catering menu categories using static data.
 * <p>
 * Called by the Catering Agent's ad-hoc subprocess when the AI model
 * decides to invoke the "Get Menu Categories" tool.
 */
@Component
public class GetMenuCategoriesWorker {

    private static final Logger log = LoggerFactory.getLogger(GetMenuCategoriesWorker.class);

    @JobWorker(type = "get-menu-categories-worker", autoComplete = true, fetchAllVariables = false)
    public Map<String, Object> getMenuCategories(final ActivatedJob job) {
        log.info("Fetching menu categories for job {}", job.getKey());

        List<Map<String, Object>> categories = List.of(
                Map.of(
                        "id", "cat_001",
                        "label", "Appetizers",
                        "description", "Perfect for sharing or a light start."
                ),
                Map.of(
                        "id", "cat_002",
                        "label", "Main Courses",
                        "description", "Our signature selection of hearty entrees."
                ),
                Map.of(
                        "id", "cat_003",
                        "label", "Beverages",
                        "description", "Refreshing sodas, juices, and house blends."
                )
        );

        log.info("Returning {} menu categories for job {}", categories.size(), job.getKey());
        return Map.of("toolCallResult", categories);
    }
}
