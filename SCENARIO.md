# AI Agent Chat With Tools -- Full Process Scenario

## Process Overview

**Process ID**: `ai-agent-chat-with-tools` (v3.0)
**Platform**: Camunda 8 SaaS (Zeebe), execution platform version 8.8.0
**AI Model**: AWS Bedrock -- `us.anthropic.claude-3-5-haiku-20241022-v1:0`

The process implements a **message-driven chat loop** with a **multi-agent architecture**. User requests are classified by a routing layer and dispatched to one of four specialized AI agents, each owning a distinct set of tools. The conversation continues indefinitely until the user stops replying, at which point a 30-minute inactivity timer ends the session.

---

## Architecture

```
+-------------------+         +--------------------+         +---------------------+
|                   |  HTTP   |                    |  gRPC / |                     |
|   React Frontend  | ------> |  Spring Boot       | REST    |  Camunda 8 SaaS     |
|   (Vite, :5173)   | <------ |  Backend (:8081)   | ------> |  (Zeebe Engine)     |
|                   |         |                    | <------ |                     |
+-------------------+         +--------------------+         +---------------------+
                                                                      |
                                                              Request Classifier
                                                              (FEEL keyword routing)
                                                                      |
                                                         +------------+------------+
                                                         |            |            |
                                                    User Data    Content &     Utility &
                                                    Agent        Entertainment Web Agent
                                                                 Agent
                                                         |            |            |
                                                         +------+-----+-----+-----+
                                                                |           |
                                                          General Agent   Error Handler
                                                          (fallback)
                                                                |
                                                    AI Agent Connector (AWS Bedrock Claude)
                                                                |
                                                        +-------+-------+
                                                        | Tool calls    |
                                                        | (HTTP/Script) |
                                                        +---------------+
```

---

## Multi-Agent Routing

The process uses an **AI Classifier Gateway** pattern:

1. A **Classify Request** script task evaluates the user input using keyword-based FEEL expressions
2. The classifier sets a `routeCategory` variable (`user_data`, `content`, `utility`, or `general`)
3. An **Exclusive Gateway** routes the request to the matching specialized agent
4. A **Merge Gateway** collects the result from whichever agent processed the request

### Routing Keywords

| Category | Keywords | Target Agent |
|---|---|---|
| `user_data` | user, users, person, contact, people, email, phone, member, customer, profile, account | User Data Agent |
| `content` | recipe, cook, dish, cuisine, joke, funny, humor, laugh, food, meal, ingredient | Content & Entertainment Agent |
| `utility` | time, date, clock, calculate, superflux, math, url, fetch, http, website, now, today, convert | Utility & Web Agent |
| `general` | (default -- no keyword match) | General Agent |

---

## Process Flow Diagram

```
  [Message Start]
  "ai-chat-start"
       |
       v
  (Start/Continue) --> [Classify Request] --> (Route by Category)
       ^                                        /   |   |    \
       |                                       /    |   |     \
       |                           [User Data] [Content] [Utility] [General]
       |                            Agent       Agent     Agent     Agent
       |                                \       |     |      /
       |                                 \      |     |     /
       |                                  (Merge Results)
       |                                       |
       |                            [Event-Based Gateway]
       |                           "Wait for user or timeout"
       |                                /            \
       |                               /              \
       |                   [Message Catch]    [Timer: 30 min]
       |                   "ai-chat-user-     "PT30M"
       |                    reply"                 |
       +-------- loop back ---+                    v
                                           [End: Session ended
                                            (inactivity)]
```

---

## Detailed Sequence

### Phase 1: Session Initialization

**Actor**: User opens the chat UI in the browser.

1. The React frontend renders the `ChatWindow` component in `idle` phase, showing a welcome screen with quick-prompt buttons:
   - "Tell me a joke"
   - "List all users"
   - "Search for pasta recipes"
   - "What's the date and time?"
   - "Calculate the superflux product of 5 and 3"

2. The user types a message (e.g., "Tell me a joke") or clicks a quick prompt.

### Phase 2: Starting the Chat Session

**Actors**: Frontend, Backend, Camunda Engine

3. The frontend calls `POST /api/chat/start` with body `{ "inputText": "Tell me a joke" }`.

4. The backend (`ChatController.startChat`) delegates to `CamundaChatService.startSession`:
   - Generates a UUID `sessionId` (e.g., `"b3f1a2c4-..."`)
   - Publishes a Zeebe message via the Camunda Java client:
     ```
     messageName:    "ai-chat-start"
     correlationKey: ""  (not needed for message start events)
     variables: {
       "sessionId":       "b3f1a2c4-...",
       "inputText":       "Tell me a joke",
       "inputDocuments":  []
     }
     timeToLive: 30 seconds
     ```
   - This message triggers the **Message Start Event** (`StartEvent_ChatSessionStarted`) in the BPMN, creating a new process instance.

5. The backend then locates the newly created process instance:
   - Polls `POST /v2/process-instances/search` (up to 20 attempts, 1.5 seconds apart)
   - For each returned process instance, fetches its variables via `POST /v2/variables/search` (filtered by `processInstanceKey`)
   - Matches by comparing the `sessionId` variable
   - Stores the `sessionId -> processInstanceKey` mapping in an in-memory `ConcurrentHashMap`

6. The backend returns to the frontend:
   ```json
   {
     "sessionId": "b3f1a2c4-...",
     "processInstanceKey": "2251799813685249"
   }
   ```

7. The frontend stores the `sessionId`, sets phase to `thinking`, and begins polling for the AI response.

### Phase 3: Request Classification and Routing

**Actors**: Camunda Engine

8. Inside the Camunda engine, the process instance flows:
   - **Start Event** -> **Exclusive Gateway** ("Start / continue") -> **Classify Request** (script task)

9. The **Classify Request** script task:
   - Reads the user input: `=lower case(if (is defined(followUpInput)) then followUpInput else inputText)`
   - Evaluates keyword-based FEEL expressions to determine `routeCategory`
   - Example: "Tell me a joke" contains "joke" -> `routeCategory = "content"`

10. The **Route by Category** exclusive gateway evaluates `routeCategory` and routes to the appropriate agent:
    - `"user_data"` -> User Data Agent
    - `"content"` -> Content & Entertainment Agent
    - `"utility"` -> Utility & Web Agent
    - default -> General Agent

### Phase 4: Specialized Agent Processing

**Actors**: Camunda Engine, AI Agent Connector, External APIs

11. The selected agent subprocess activates. Each agent is an ad-hoc subprocess powered by the Camunda Agentic AI connector (`io.camunda.agenticai:aiagent-job-worker:1`), configured with:
    - **Provider**: AWS Bedrock (us-east-1)
    - **Model**: Claude 3.5 Haiku
    - **System prompt**: Tailored to the agent's domain (see Agent Details below)
    - **User prompt**: `=if (is defined(followUpInput)) then followUpInput else inputText`
    - **Memory**: In-process, context window size of 20 messages
    - **Max model calls**: 20 per turn (5 for General Agent)
    - **Tool behavior**: `WAIT_FOR_TOOL_CALL_RESULTS`

12. The agent reads the user's message and decides which of its tools to invoke. Each tool call is executed as a task within the ad-hoc subprocess.

#### User Data Agent

System prompt: Specializes in user lookups and contact information. Never fabricates details.

| Tool | Type | Description |
|---|---|---|
| List Users | HTTP GET `jsonplaceholder.typicode.com/users` | Returns id, name, username for all users |
| Load User by ID | HTTP GET `jsonplaceholder.typicode.com/users/{id}` | Returns full user details or "User not found" |

#### Content & Entertainment Agent

System prompt: Helps find recipes, tells jokes, and provides fun content.

| Tool | Type | Description |
|---|---|---|
| Search Recipe | HTTP GET `dummyjson.com/recipes/search?q={query}` | Searches recipes by dish name or cuisine |
| Jokes API | HTTP GET `v2.jokeapi.dev/joke/Any?format=txt&safe-mode` | Fetches a random safe-mode joke |

#### Utility & Web Agent

System prompt: Handles date/time, calculations, and URL fetching.

| Tool | Type | Description |
|---|---|---|
| Get Date and Time | Script `=now()` | Returns current date/time with timezone |
| Superflux Product | Script `=3 * (inputA + inputB)` | Domain-specific calculation of two numbers |
| Fetch URL | HTTP GET `{url}` | Fetches contents of any valid HTTP(S) URL |

#### General Agent (Fallback)

System prompt: General knowledge assistant. Answers based on built-in knowledge and can suggest specialized agents for domain-specific requests.

| Tool | Type | Description |
|---|---|---|
| Knowledge Answer | Script (FEEL) | System placeholder required by the ad-hoc subprocess. Returns a static string. The agent answers all questions from its own knowledge and is instructed never to call this tool. |

> **Note — Placeholder Tool Pattern**: The Camunda AI Agent connector requires at least one tool inside its ad-hoc subprocess. Since the General Agent answers entirely from its own training data, the `Knowledge Answer` script task exists only to satisfy this structural requirement. Its system prompt explicitly instructs the agent to never call it, and its expression simply returns the string `"No tool call needed. Answer from your own knowledge."`. If you add a new agent that also needs no external tools, replicate this pattern.

13. The agent may call one or more tools, potentially in sequence. Each tool call result is collected into `toolCallResults` with structure `{ id, name, content }`.

14. After all tool calls complete, the agent formulates a natural-language response. The agent connector writes:
    - `agent.responseText` -- the text response to show the user
    - `agent.context` -- the conversation memory (opaque, preserved per-agent via isolated context variables)

15. The process flows from the agent subprocess through the **Merge Results** gateway to the **Event-Based Gateway** ("Wait for user or timeout").

### Phase 5: Response Delivery

**Actors**: Frontend, Backend

16. While the agent processes (steps 8-15), the frontend polls every 3 seconds:
    - `GET /api/chat/{sessionId}/response`

17. The backend (`CamundaChatService.getResponse`):
    - Looks up the session's `processInstanceKey`
    - Calls `POST /v2/variables/search` (filtered by `processInstanceKey`) on the Camunda cluster
    - Extracts `agent.responseText` from the returned variables
    - Also extracts the `routeCategory` variable and resolves it to a human-readable agent label (e.g., `"Content & Entertainment Agent"`)
    - Compares `agent.responseText` to the last known response:
      - If no `agent.responseText` exists yet, or it matches the previous turn's response -> returns `{ "status": "processing", "responseText": null, "handledBy": null }`
      - If a new `agent.responseText` is detected -> stores it as the last known response and returns `{ "status": "ready", "responseText": "Here's a joke for you: ...", "handledBy": "Content & Entertainment Agent" }`

18. The frontend receives `status: "ready"`, stops polling, adds the AI response as a message bubble with a subtle "Answered by {agent}" label, and transitions to `ready` phase. The chat input appears with the placeholder "Type a follow-up...".

### Phase 6: Follow-Up Conversation

**Actors**: User, Frontend, Backend, Camunda Engine

19. The user types a follow-up message (e.g., "Tell me another one").

20. The frontend calls `POST /api/chat/{sessionId}/reply` with body `{ "followUpInput": "Tell me another one" }`.

21. The backend (`CamundaChatService.sendReply`):
    - Publishes a Zeebe message:
      ```
      messageName:    "ai-chat-user-reply"
      correlationKey: "b3f1a2c4-..."  (the sessionId)
      variables: {
        "followUpInput":      "Tell me another one",
        "followUpDocuments":  []
      }
      timeToLive: 30 seconds
      ```
    - Marks the session as `awaitingResponse = true` so the response poller knows to wait for a changed value

22. In the Camunda engine, the **Message Catch Event** (`MessageCatchEvent_UserReply`) receives the correlated message:
    - Correlation subscription: `correlationKey = sessionId`
    - The message match causes the process to leave the event gateway
    - The `followUpInput` and `followUpDocuments` variables are set on the process instance

23. The process loops back through the **Exclusive Gateway** ("Start / continue") to the **Classify Request** task. The classifier re-evaluates the new input and routes to the appropriate agent. The routing may change between turns (e.g., user asks about users, then asks for a joke).

24. The selected agent processes the follow-up:
    - The user prompt expression resolves to the follow-up text
    - Each agent reads its own isolated context variable (e.g., `userDataAgentCtx`), so conversation history is preserved only within the same agent type across turns
    - The agent decides which tools to call (if any) and generates a new response
    - `agent.responseText` is overwritten with the new response; `agent.context` is saved back to the agent-specific context variable

25. The process returns to the event-based gateway. The frontend, which has been polling again since step 20, detects the new `agent.responseText` (different from the previous turn) and displays it.

26. Steps 19-25 repeat for each follow-up message. The conversation can continue indefinitely.

### Phase 7: Session Termination

**Actors**: Camunda Engine (timer)

27. If the user stops sending messages, the **30-minute timer** (`TimerEvent_Timeout`, duration `PT30M`) fires.

28. The timer wins the event-based gateway race against the message catch event. The process flows to the **End Event** ("Session ended (inactivity)") and the process instance completes.

29. On the frontend, if the user returns after the timeout and tries to send a follow-up, the `sendReply` call will fail (the process no longer exists). The error is shown, and the user can start a new chat.

Alternatively, the user can click the "New Chat" button at any time to reset the frontend state and start a fresh session.

---

## Complete Interaction Sequence Diagram

```
User            Frontend            Backend             Camunda Engine         Classifier / Agents
 |                 |                   |                      |                      |
 |  Type message   |                   |                      |                      |
 |---------------->|                   |                      |                      |
 |                 | POST /start       |                      |                      |
 |                 |------------------>|                      |                      |
 |                 |                   | publishMessage       |                      |
 |                 |                   | "ai-chat-start"      |                      |
 |                 |                   |--------------------->|                      |
 |                 |                   |                      | Create PI            |
 |                 |                   |                      |----+                 |
 |                 |                   |                      |    |                 |
 |                 |                   | search PI by session |<---+                 |
 |                 |                   |--------------------->|                      |
 |                 |                   |<---------------------|                      |
 |                 |  {sessionId, PIK} |                      |                      |
 |                 |<------------------|                      |                      |
 |                 |                   |                      | Classify Request     |
 |                 |                   |                      |--------------------->|
 |                 |                   |                      |                      | routeCategory
 |                 |                   |                      |                      |----+
 |                 |                   |                      | Route -> Agent       |<---+
 |                 |                   |                      |--------------------->|
 |                 |                   |                      |                      | Tool calls
 |                 |                   |                      |                      | (HTTP/Script)
 |                 |                   |                      |                      |----+
 |                 |                   |                      |                      |    |
 |                 | GET /response     |                      |                      |    |
 |                 |------------------>| fetch PI variables   |                      |    |
 |                 |                   |--------------------->|                      |    |
 |                 |                   |<---------------------|                      |    |
 |                 | {processing}      |                      |                      |    |
 |                 |<------------------|                      |                      |    |
 |                 |                   |                      |                      |<---+
 |                 |                   |                      | agent.responseText   |
 |                 |                   |                      |<---------------------|
 |                 |                   |                      | Merge -> Event GW    |
 |                 | GET /response     |                      |                      |
 |                 |------------------>| fetch PI variables   |                      |
 |                 |                   |--------------------->|                      |
 |                 |                   |<---------------------|                      |
 |                 | {ready, text}     |                      |                      |
 |                 |<------------------|                      |                      |
 | Show response   |                   |                      |                      |
 |<----------------|                   |                      |                      |
 |                 |                   |                      |                      |
 |  Type follow-up |                   |                      |                      |
 |---------------->|                   |                      |                      |
 |                 | POST /reply       |                      |                      |
 |                 |------------------>|                      |                      |
 |                 |                   | publishMessage       |                      |
 |                 |                   | "ai-chat-user-reply" |                      |
 |                 |                   |--------------------->|                      |
 |                 |                   |                      | Catch message        |
 |                 |                   |                      | -> Classify again    |
 |                 |                   |                      |--------------------->|
 |                 |                   |                      |                      | (route & process)
 |                 |                   |                      |                      |
 |                 |    ... polling until new response ...    |                      |
 |                 |                   |                      |                      |
 |                 |                   |                      |                      |
 |   (30 min idle) |                   |                      |                      |
 |                 |                   |                      | Timer fires          |
 |                 |                   |                      |----+                 |
 |                 |                   |                      |    | End Event       |
 |                 |                   |                      |<---+                 |
```

---

## Key Variables

| Variable | Set By | Description |
|---|---|---|
| `sessionId` | Backend (UUID) | Unique session identifier, used as message correlation key |
| `inputText` | User (via frontend) | The user's initial chat message |
| `inputDocuments` | Frontend (always `[]`) | Optional document attachments for the initial message |
| `followUpInput` | User (via frontend) | The user's follow-up message text |
| `followUpDocuments` | Frontend (always `[]`) | Optional document attachments for follow-up messages |
| `currentInput` | Classify Request task | Lowercased user input used for keyword matching |
| `routeCategory` | Classify Request task | Classification result: `user_data`, `content`, `utility`, or `general` |
| `agent` | AI Agent connector | Object containing `responseText` (the AI reply) and `context` (conversation memory) |
| `agent.responseText` | AI Agent connector | The natural-language response text from the AI agent |
| `agent.context` | AI Agent connector | Opaque conversation context produced by the connector each turn |
| `userDataAgentCtx` | User Data Agent output | Isolated conversation context for the User Data Agent (persisted across turns) |
| `contentAgentCtx` | Content Agent output | Isolated conversation context for the Content & Entertainment Agent |
| `utilityAgentCtx` | Utility Agent output | Isolated conversation context for the Utility & Web Agent |
| `generalAgentCtx` | General Agent output | Isolated conversation context for the General Agent |
| `toolCallResults` | Ad-hoc subprocess | Array of `{ id, name, content }` objects from tool calls within the current turn |

---

## API Endpoints Summary

| Method | Endpoint | Request Body | Response | Purpose |
|---|---|---|---|---|
| `POST` | `/api/chat/start` | `{ "inputText": "..." }` | `{ "sessionId": "...", "processInstanceKey": "..." }` | Start a new chat session |
| `GET` | `/api/chat/{sessionId}/response` | -- | `{ "status": "processing"\|"ready", "responseText": "...", "handledBy": "..." }` | Poll for the AI agent's response (includes which agent handled it) |
| `POST` | `/api/chat/{sessionId}/reply` | `{ "followUpInput": "..." }` | `200 OK` (empty body) | Send a follow-up message |

---

## Camunda Messages

| Message Name | Direction | Correlation Key | Variables | BPMN Element |
|---|---|---|---|---|
| `ai-chat-start` | Backend -> Engine | (none, start event) | `sessionId`, `inputText`, `inputDocuments` | `StartEvent_ChatSessionStarted` |
| `ai-chat-user-reply` | Backend -> Engine | `=sessionId` | `followUpInput`, `followUpDocuments` | `MessageCatchEvent_UserReply` |

---

## Error Handling and Edge Cases

1. **Backend not running**: The frontend shows "Failed to start conversation. Is the backend running?" and stays in `idle` phase.

2. **Process instance not found**: If the backend cannot locate the process instance after publishing the start message (20 attempts over ~30 seconds), it throws a `ProcessStartException` and returns HTTP 503.

3. **Follow-up after timeout**: If the user sends a follow-up after the 30-minute timer has ended the process, the Zeebe message publish may fail (no subscriber). The backend detects this, checks whether the process instance is in a terminal state (`COMPLETED`/`CANCELED`), marks the session expired, and returns HTTP 410 Gone. The frontend transitions to `expired` phase and prompts the user to start a new chat. If the publish silently succeeds but nothing correlates, the response poller detects the empty-variable state after 60 consecutive polls, performs the same terminal-state check, and expires the session.

4. **AI agent errors**: Each specialized agent has an **error boundary event**. If an agent fails (e.g., Bedrock API error), the boundary event catches the error and routes to a shared **Handle Agent Error** script task, which sets a user-friendly error message in `agent.responseText`. The chat loop continues normally, allowing the user to retry. If the error is not caught by the boundary event, the agent connector's built-in retry mechanism (3 retries) is used. If all retries fail, the process instance enters an incident state in Camunda Operate.

5. **Per-agent context isolation**: Each agent stores its conversation history in a dedicated process variable (`userDataAgentCtx`, `contentAgentCtx`, `utilityAgentCtx`, `generalAgentCtx`). When routing changes between turns (e.g., user asks about users, then asks for a joke), each agent starts with its own isolated history — preventing cross-contamination of tool knowledge and conversation context between different agent types. When the same agent handles consecutive turns, it retains its full conversation history.

6. **Routing misclassification**: If the keyword classifier routes to the wrong agent, the agent will still attempt to answer using its available tools. If no tool matches, the agent generates an answer from its knowledge or informs the user that it cannot help with that specific request.
