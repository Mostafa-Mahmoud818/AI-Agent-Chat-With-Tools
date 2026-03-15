package com.example.aichat.worker;

import io.camunda.client.annotation.JobWorker;
import io.camunda.client.api.response.ActivatedJob;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * AI Agent tool worker — returns dishes for a given menu category using static data.
 * <p>
 * Called by the Catering Agent's ad-hoc subprocess when the AI model
 * decides to invoke the "Get Dishes by Category" tool.
 */
@Component
public class GetDishesByCategoryWorker {

    private static final Logger log = LoggerFactory.getLogger(GetDishesByCategoryWorker.class);

    private static final Map<String, List<Map<String, Object>>> DISHES_BY_CATEGORY = Map.of(
            "cat_001", List.of(
                    Map.of(
                            "id", "item_bruschetta_01",
                            "label", "Classic Bruschetta",
                            "description", "Toasted bread with tomatoes, basil, and olive oil.",
                            "price", 9.50
                    ),
                    Map.of(
                            "id", "item_wings_01",
                            "label", "Buffalo Wings",
                            "description", "Crispy wings tossed in spicy buffalo sauce.",
                            "price", 12.00
                    ),
                    Map.of(
                            "id", "item_soup_01",
                            "label", "French Onion Soup",
                            "description", "Rich broth with caramelized onions and melted gruyère.",
                            "price", 10.00
                    )
            ),
            "cat_002", List.of(
                    Map.of(
                            "id", "item_steak_01",
                            "label", "Ribeye Steak",
                            "description", "300g Grilled steak with garlic butter.",
                            "price", 28.00
                    ),
                    Map.of(
                            "id", "item_salmon_01",
                            "label", "Pan-Seared Salmon",
                            "description", "Served with roasted asparagus and lemon.",
                            "price", 22.50
                    ),
                    Map.of(
                            "id", "item_pasta_01",
                            "label", "Wild Mushroom Risotto",
                            "description", "Creamy arborio rice with truffle oil.",
                            "price", 18.00
                    )
            ),
            "cat_003", List.of(
                    Map.of(
                            "id", "item_lemonade_01",
                            "label", "Fresh Lemonade",
                            "description", "House-squeezed with a hint of mint.",
                            "price", 5.00
                    ),
                    Map.of(
                            "id", "item_coffee_01",
                            "label", "Espresso",
                            "description", "Double-shot Italian espresso.",
                            "price", 4.50
                    ),
                    Map.of(
                            "id", "item_smoothie_01",
                            "label", "Tropical Smoothie",
                            "description", "Mango, pineapple, and coconut blend.",
                            "price", 7.00
                    )
            )
    );

    @JobWorker(type = "get-dishes-by-category-worker", autoComplete = true, fetchAllVariables = false)
    public Map<String, Object> getDishesByCategory(final ActivatedJob job) {
        String categoryId = (String) job.getVariable("categoryId");
        log.info("Fetching dishes for category '{}' for job {}", categoryId, job.getKey());

        List<Map<String, Object>> dishes = DISHES_BY_CATEGORY.get(categoryId);

        if (dishes == null) {
            log.warn("Unknown category '{}' for job {}", categoryId, job.getKey());
            return Map.of("toolCallResult",
                    "No dishes found for category '" + categoryId + "'. Valid categories are: cat_001 (Appetizers), cat_002 (Main Courses), cat_003 (Beverages).");
        }

        log.info("Returning {} dishes for category '{}' for job {}", dishes.size(), categoryId, job.getKey());
        return Map.of("toolCallResult", dishes);
    }
}
