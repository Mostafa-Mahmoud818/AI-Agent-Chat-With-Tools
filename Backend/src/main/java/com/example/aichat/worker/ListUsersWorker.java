package com.example.aichat.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.camunda.client.annotation.JobWorker;
import io.camunda.client.api.response.ActivatedJob;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * AI Agent tool worker — lists all users using static data.
 * <p>
 * Called by the User Data Agent's ad-hoc subprocess when the AI model
 * decides to invoke the "List users" tool. Returns a summary array of
 * users (id, name, username, email) as {@code toolCallResult} so the AI Agent
 * connector can feed it back to the model.
 */
@Component
public class ListUsersWorker {

    private static final Logger log = LoggerFactory.getLogger(ListUsersWorker.class);

    private final ObjectMapper objectMapper;

    // Static data representing a list of users
    private static final String STATIC_USERS_JSON = """
            [
              {
                "id": 1,
                "name": "Leanne Graham",
                "username": "Bret",
                "email": "Sincere@april.biz"
              },
              {
                "id": 2,
                "name": "Ervin Howell",
                "username": "Antonette",
                "email": "Shanna@melissa.tv"
              },
              {
                "id": 3,
                "name": "Clementine Bauch",
                "username": "Samantha",
                "email": "Nathan@yesenia.net"
              },
              {
                "id": 4,
                "name": "Patricia Lebsack",
                "username": "Karianne",
                "email": "Julianne.OConner@kory.org"
              },
              {
                "id": 5,
                "name": "Chelsey Dietrich",
                "username": "Kamren",
                "email": "Lucio_Hettinger@annie.ca"
              },
              {
                "id": 6,
                "name": "Mrs. Dennis Schulist",
                "username": "Leopoldo_Corkery",
                "email": "Karley_Dach@jasper.info"
              },
              {
                "id": 7,
                "name": "Kurtis Weissnat",
                "username": "Elwyn.Skiles",
                "email": "Telly.Hoeger@billy.biz"
              },
              {
                "id": 8,
                "name": "Nicholas Runolfsdottir V",
                "username": "Maxime_Nienow",
                "email": "Sherwood@rosamond.me"
              },
              {
                "id": 9,
                "name": "Glenna Reichert",
                "username": "Delphine",
                "email": "Chaim_McDermott@dana.io"
              },
              {
                "id": 10,
                "name": "Clementina DuBuque",
                "username": "Moriah.Stanton",
                "email": "Rey.Padberg@karina.biz"
              }
            ]
            """;

    public ListUsersWorker(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @JobWorker(type = "list-users-worker", autoComplete = true, fetchAllVariables = false)
    public Map<String, Object> listUsers(final ActivatedJob job) {
        log.info("Fetching static user list for job {}", job.getKey());

        try {
            JsonNode usersArray = objectMapper.readTree(STATIC_USERS_JSON);
            List<Map<String, Object>> users = new ArrayList<>();

            for (JsonNode user : usersArray) {
                users.add(Map.of(
                        "id", user.get("id").asInt(),
                        "name", user.get("name").asText(),
                        "username", user.get("username").asText(),
                        "email", user.get("email").asText()));
            }

            log.info("Successfully fetched {} users from static data for job {}", users.size(), job.getKey());
            return Map.of("toolCallResult", users);

        } catch (Exception e) {
            log.error("Failed to parse static users for job {}: {}", job.getKey(), e.getMessage(), e);
            return Map.of("toolCallResult", "Sorry, I couldn't fetch the user list right now. Please try again.");
        }
    }
}
