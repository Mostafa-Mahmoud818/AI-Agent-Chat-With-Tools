package com.example.aichat.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.camunda.client.annotation.JobWorker;
import io.camunda.client.api.response.ActivatedJob;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * AI Agent tool worker — returns a static joke.
 * <p>
 * Called by the Content Agent's ad-hoc subprocess when the AI model
 * decides to invoke the "Jokes API" tool. Returns the joke text as
 * {@code toolCallResult} so the AI Agent connector can feed it back
 * to the model.
 */
@Component
public class JokesApiWorker {

    private static final Logger log = LoggerFactory.getLogger(JokesApiWorker.class);

    private final ObjectMapper objectMapper;

    // Static data representing a response from the JokeAPI
    private static final String STATIC_JOKE_JSON = """
            {
                "error": false,
                "category": "Pun",
                "type": "twopart",
                "setup": "Why did the chicken cross the road, roll in the mud and cross the road again?",
                "delivery": "He was a dirty double-crosser!",
                "flags": {
                    "nsfw": false,
                    "religious": false,
                    "political": false,
                    "racist": false,
                    "sexist": false,
                    "explicit": false
                },
                "id": 208,
                "safe": true,
                "lang": "en"
            }
            """;

    public JokesApiWorker(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @JobWorker(type = "jokes-api-worker", autoComplete = true, fetchAllVariables = false)
    public Map<String, Object> fetchJoke(final ActivatedJob job) {
        log.info("Fetching static joke for job {}", job.getKey());

        try {
            String jokeText = parseJoke(STATIC_JOKE_JSON);
            log.info("Successfully fetched static joke for job {}: {}", job.getKey(),
                    jokeText.length() > 100 ? jokeText.substring(0, 100) + "…" : jokeText);
            return Map.of("toolCallResult", jokeText);

        } catch (Exception e) {
            log.error("Failed to parse static joke for job {}: {}", job.getKey(), e.getMessage(), e);
            return Map.of("toolCallResult", "Sorry, I couldn't fetch a joke right now. Please try again.");
        }
    }

    /**
     * Parses the static JSON response into a human-readable joke string.
     */
    private String parseJoke(String body) {
        try {
            JsonNode root = objectMapper.readTree(body);

            String type = root.path("type").asText();

            if ("twopart".equals(type)) {
                String setup = root.path("setup").asText("");
                String delivery = root.path("delivery").asText("");
                return setup + "\n" + delivery;
            }

            // single joke
            return root.path("joke").asText("No joke available at the moment.");

        } catch (Exception e) {
            log.warn("Failed to parse JokeAPI response, returning raw body: {}", e.getMessage());
            return body.strip();
        }
    }
}
