# AI Agent Chat With Tools -- Full Process Scenario

## Process Overview

**Process ID**: `ai-agent-chat-with-tools` (v2.1)
**Platform**: Camunda 8 SaaS (Zeebe), execution platform version 8.8.0
**AI Model**: AWS Bedrock -- `us.anthropic.claude-3-5-haiku-20241022-v1:0`

The process implements a **message-driven chat loop** where a user converses with an AI agent that has access to seven external tools. The conversation continues indefinitely until the user stops replying, at which point a 30-minute inactivity timer ends the session.

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
                                                              AI Agent Connector
                                                              (AWS Bedrock Claude)
                                                                      |
                                                              +-------+-------+
                                                              | Tool calls    |
                                                              | (HTTP/Script) |
                                                              +---------------+
```

---

## Process Flow Diagram

```
  [Message Start]                    [Event-Based Gateway]
  "ai-chat-start"                   "Wait for user or timeout"
       |                                  /            \
       v                                 /              \
  (Start/Continue) -----> [AI Agent] --+    [Message Catch]    [Timer: 30 min]
       ^                                    "ai-chat-user-     "PT30M"
       |                                     reply"                 |
       +-------- loop back -----------------+                      v
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
   - Polls `POST /v2/process-instances/search` (up to 10 attempts, 1 second apart)
   - For each returned process instance, fetches its variables via `POST /v2/process-instances/{key}/variables/search`
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

### Phase 3: AI Agent Processing

**Actors**: Camunda Engine, AI Agent Connector, External APIs

8. Inside the Camunda engine, the process instance flows:
   - **Start Event** -> **Exclusive Gateway** ("Start / continue") -> **AI Agent** (ad-hoc subprocess)

9. The **AI Agent** ad-hoc subprocess activates. It is powered by the Camunda Agentic AI connector (`io.camunda.agenticai:aiagent-job-worker:1`), configured with:
   - **Provider**: AWS Bedrock (us-east-1)
   - **Model**: Claude 3.5 Haiku
   - **System prompt**: Instructs the agent to prefer tools over guessing, never fabricate contact details, and think step-by-step using a `<thinking>` template
   - **User prompt**: `=if (is defined(followUpInput)) then followUpInput else inputText` (uses original text for first turn, follow-up text for subsequent turns)
   - **Memory**: In-process, context window size of 20 messages
   - **Max model calls**: 20 per turn
   - **Tool behavior**: `WAIT_FOR_TOOL_CALL_RESULTS` (waits for each tool to complete before continuing)

10. The AI agent reads the user's message and decides which tool(s) to invoke. Each tool call is executed as a task within the ad-hoc subprocess. The available tools are:

#### Tool: Get Date and Time
- **Type**: Script task (FEEL expression)
- **Expression**: `=now()`
- **Description**: Returns the current date and time including timezone
- **Example output**: `"2026-02-26T14:30:00+01:00"`

#### Tool: List Users
- **Type**: HTTP JSON connector (GET)
- **URL**: `https://jsonplaceholder.typicode.com/users`
- **Description**: Lists all available users. Returns id, name, and username for each.
- **Result mapping**: Extracts `{ id, name, username }` for each user from the response body

#### Tool: Load User by ID
- **Type**: HTTP JSON connector (GET)
- **URL**: `https://jsonplaceholder.typicode.com/users/{id}` (id provided by AI via `fromAi`)
- **Description**: Loads detailed user info including email, phone, address, company
- **Result mapping**: Returns the full user object, or `"User not found"` if not found

#### Tool: Search Recipe
- **Type**: HTTP JSON connector (GET)
- **URL**: `https://dummyjson.com/recipes/search?q={searchQuery}` (query provided by AI via `fromAi`)
- **Description**: Searches for recipes by a search query (e.g., a dish name or cuisine)
- **Result mapping**: Returns the array of matching recipes, or `"No result found."` if empty

#### Tool: Superflux Product Calculation
- **Type**: Script task (FEEL expression)
- **Expression**: `=3 * (inputA + inputB)` (inputA and inputB provided by AI via `fromAi`)
- **Description**: Calculates the "superflux product" of two numbers -- a domain-specific calculation only this tool can perform

#### Tool: Jokes API
- **Type**: HTTP JSON connector (GET)
- **URL**: `https://v2.jokeapi.dev/joke/Any?format=txt&safe-mode`
- **Description**: Fetches a random joke from the JokeAPI (safe mode, text format)
- **Result mapping**: Returns the response body (plain text joke)

#### Tool: Fetch URL
- **Type**: HTTP JSON connector (GET)
- **URL**: Provided by the AI via `fromAi` (any valid HTTP/HTTPS URL)
- **Description**: Fetches the contents of a given URL. Only accepts valid RFC 3986/RFC 7230 HTTP(s) URLs.
- **Result mapping**: Returns `response.document` (the fetched page content)

11. The AI agent may call one or more tools, potentially in sequence (e.g., "List users" then "Load user by ID 3" to get details). Each tool call result is collected into `toolCallResults` with structure `{ id, name, content }`.

12. After all tool calls complete, the AI agent formulates a natural-language response incorporating the tool results. The agent connector writes:
    - `agent.responseText` -- the text response to show the user
    - `agent.context` -- the conversation memory (opaque, preserved across turns)

13. The process flows out of the AI Agent subprocess to the **Event-Based Gateway** ("Wait for user or timeout").

### Phase 4: Response Delivery

**Actors**: Frontend, Backend

14. While the AI agent processes (steps 8-13), the frontend polls every 3 seconds:
    - `GET /api/chat/{sessionId}/response`

15. The backend (`CamundaChatService.getResponse`):
    - Looks up the session's `processInstanceKey`
    - Calls `POST /v2/process-instances/{key}/variables/search` on the Camunda cluster
    - Extracts `agent.responseText` from the returned variables
    - Compares it to the last known response:
      - If no `agent.responseText` exists yet, or it matches the previous turn's response -> returns `{ "status": "processing", "responseText": null }`
      - If a new `agent.responseText` is detected -> stores it as the last known response and returns `{ "status": "ready", "responseText": "Here's a joke for you: ..." }`

16. The frontend receives `status: "ready"`, stops polling, adds the AI response as a message bubble, and transitions to `ready` phase. The chat input appears with the placeholder "Type a follow-up...".

### Phase 5: Follow-Up Conversation

**Actors**: User, Frontend, Backend, Camunda Engine

17. The user types a follow-up message (e.g., "Tell me another one").

18. The frontend calls `POST /api/chat/{sessionId}/reply` with body `{ "followUpInput": "Tell me another one" }`.

19. The backend (`CamundaChatService.sendReply`):
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

20. In the Camunda engine, the **Message Catch Event** (`MessageCatchEvent_UserReply`) receives the correlated message:
    - Correlation subscription: `correlationKey = sessionId`
    - The message match causes the process to leave the event gateway
    - The `followUpInput` and `followUpDocuments` variables are set on the process instance

21. The process loops back through the **Exclusive Gateway** ("Start / continue") to the **AI Agent** again.

22. The AI agent processes the follow-up:
    - The user prompt expression `=if (is defined(followUpInput)) then followUpInput else inputText` now resolves to `"Tell me another one"`
    - The `agent.context` from the previous turn is fed back in, preserving conversation history
    - The agent decides which tools to call (if any) and generates a new response
    - `agent.responseText` is overwritten with the new response

23. The process returns to the event-based gateway. The frontend, which has been polling again since step 18, detects the new `agent.responseText` (different from the previous turn) and displays it.

24. Steps 17-23 repeat for each follow-up message. The conversation can continue indefinitely.

### Phase 6: Session Termination

**Actors**: Camunda Engine (timer)

25. If the user stops sending messages, the **30-minute timer** (`TimerEvent_Timeout`, duration `PT30M`) fires.

26. The timer wins the event-based gateway race against the message catch event. The process flows to the **End Event** ("Session ended (inactivity)") and the process instance completes.

27. On the frontend, if the user returns after the timeout and tries to send a follow-up, the `sendReply` call will fail (the process no longer exists). The error is shown, and the user can start a new chat.

Alternatively, the user can click the "New Chat" button at any time to reset the frontend state and start a fresh session.

---

## Complete Interaction Sequence Diagram

```
User            Frontend            Backend             Camunda Engine         AI Agent / Tools
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
 |                 |                   |                      | Gateway -> AI Agent  |
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
 |                 |                   |                      | -> Event Gateway     |
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
 |                 |                   |                      | -> loop to AI Agent  |
 |                 |                   |                      |--------------------->|
 |                 |                   |                      |                      | (process again)
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
| `agent` | AI Agent connector | Object containing `responseText` (the AI reply) and `context` (conversation memory) |
| `agent.responseText` | AI Agent connector | The natural-language response text from the AI agent |
| `agent.context` | AI Agent connector | Opaque conversation context, fed back into subsequent turns to maintain memory |
| `toolCallResults` | Ad-hoc subprocess | Array of `{ id, name, content }` objects from tool calls within the current turn |

---

## API Endpoints Summary

| Method | Endpoint | Request Body | Response | Purpose |
|---|---|---|---|---|
| `POST` | `/api/chat/start` | `{ "inputText": "..." }` | `{ "sessionId": "...", "processInstanceKey": "..." }` | Start a new chat session |
| `GET` | `/api/chat/{sessionId}/response` | -- | `{ "status": "processing"\|"ready", "responseText": "..." }` | Poll for the AI agent's response |
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

2. **Process instance not found**: If the backend cannot locate the process instance after publishing the start message (10 retries), it throws a runtime exception and returns a 500 error.

3. **Follow-up after timeout**: If the user sends a follow-up after the 30-minute timer has ended the process, the Zeebe message publish may fail (no subscriber). The backend detects this, checks whether the process instance is in a terminal state (`COMPLETED`/`CANCELED`), marks the session expired, and returns HTTP 410 Gone. The frontend transitions to `expired` phase and prompts the user to start a new chat. If the publish silently succeeds but nothing correlates, the response poller detects the empty-variable state after 60 consecutive polls, performs the same terminal-state check, and expires the session.

4. **AI agent errors**: If the AI agent fails (e.g., Bedrock API error), the agent connector has 3 retries configured. If all retries fail, the process instance enters an incident state in Camunda Operate.

5. **Multiple tool calls**: The AI agent can call multiple tools in a single turn. For example, asking "Who is user 3 and what time is it?" could trigger both "Load user by ID" and "Get Date and Time" before composing a combined response.
