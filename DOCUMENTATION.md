# AI Agent Chat With Tools — Full Implementation Documentation

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [BPMN Process Design](#3-bpmn-process-design)
4. [Backend Architecture](#4-backend-architecture)
5. [Backend Component Details](#5-backend-component-details)
6. [Chat Session Lifecycle](#6-chat-session-lifecycle)
7. [Server-Sent Events Flow](#7-server-sent-events-flow)
8. [Message Correlation Flow](#8-message-correlation-flow)
9. [Authentication and Security](#9-authentication-and-security)
10. [Frontend Architecture](#10-frontend-architecture)
11. [REST API Reference](#11-rest-api-reference)
12. [Error Handling](#12-error-handling)
13. [Configuration Reference](#13-configuration-reference)
14. [Testing](#14-testing)
15. [Project Structure](#15-project-structure)

### Feature-Specific Documentation

- [Catering Service](./docs/catering-service.md) — Menu browsing, agent tools, and frontend rendering

---

## 1. System Overview

AI Agent Chat With Tools is a three-tier web application orchestrated by **Camunda 8 SaaS** with **dual-mode authentication** (guest via cookie or JWT secure). A **React/Vite** frontend presents a conversational chat interface with conversation history and multi-session support. The **Modulith Service** backend on port 8085 provides conversation and session management via REST APIs (`/api/v1/public/chatting` for guests, `/api/v1/secure/chatting` for authenticated users). The backend translates chat interactions into Zeebe messages that start and drive BPMN processes on Camunda Cloud. Those processes classify each request, route it to one of four AI agent subprocesses (User Data, Utility & Web, Catering, General), and invoke external REST APIs, Zeebe job workers, or FEEL scripts to gather results. The backend delivers responses back to the browser in real time via **Server-Sent Events (SSE)**, eliminating polling latency. Each conversation can have multiple sessions, and each session is a long-running BPMN process instance.

---

## 2. Architecture Diagram

```mermaid
graph TD
    subgraph browser [Browser]
        FE["React/Vite App\nport 5173"]
    end

    subgraph backend [Modulith Backend\nport 8085]
        CTRL["REST API\n/api/v1/public/chatting\n/api/v1/secure/chatting"]
        SVC["ChatService\nOrchestration"]
        DB["PostgreSQL\ndxp-chatting"]
        PUB["MessagePublisher\nZeebe gRPC"]
        RC["CamundaRestClient\nCluster REST API v2"]
    end

    subgraph camunda [Camunda 8 SaaS]
        ZEEBE["Zeebe Engine\ngRPC :443"]
        CAPI["Cluster REST API v2\nhttps://region.zeebe.camunda.io"]
        AI["AI Agent Job Worker\nAWS Bedrock / Claude"]
    end

    subgraph external [External APIs]
        JP["JSONPlaceholder\njsonplaceholder.typicode.com"]
        DJ["DummyJSON\ndummyjson.com"]
        FETCH["Any URL\nFetch_URL tool"]
        MENU["Menu API\n(mock.apidog.com\ncatering tools)"]
    end

    FE -->|"Guest: POST /conversations\nSSE: /assistant-round/stream"| CTRL
    FE -->|"JWT: POST /orchestration/.../start\nsame SSE pattern"| CTRL

    CTRL --> SVC
    SVC --> DB
    SVC --> PUB
    SVC --> RC

    PUB -->|"correlate() / publish()\ngRPC TLS"| ZEEBE
    RC -->|"POST /v2/variables/search\nPOST /v2/process-instances/search"| CAPI

    ZEEBE --> AI
    ZEEBE -->|"HTTP Connector"| JP
    ZEEBE -->|"HTTP Connector"| DJ
    ZEEBE -->|"HTTP Connector"| FETCH
    ZEEBE -->|"Job workers\n+ HTTP"| MENU
```

### Communication Protocols Summary

| Link | Protocol | Detail |
|------|----------|--------|
| Frontend → Backend (HTTP) | HTTP/1.1 over TCP | REST JSON, port 8085 |
| Frontend → Backend (SSE) | HTTP/1.1, `text/event-stream` | `EventSource` persistent connection |
| Backend → Zeebe | gRPC over TLS | Port 443, `grpcs://` address |
| Backend → Cluster REST API | HTTPS | Bearer token (OAuth2) |
| Camunda → External APIs | HTTPS | HTTP JSON Connector (`io.camunda:http-json:1`) |
| Frontend Auth | Cookie + localStorage | Guest: `ankabut_guest_id` cookie; Secure: JWT in localStorage |

---

## 3. BPMN Process Design

### 3.1 Two Process Architectures

The repository contains two distinct BPMN implementations of the same business logic. Both share the same message names and variable contracts.

#### Architecture A — Monolithic (`ai-agent-chat-with-tools.bpmn`)

All four AI agent subprocesses are embedded as **Ad-Hoc SubProcesses** directly inside the single main process. Suitable for self-contained deployment where everything deploys as one unit.

- **Process ID:** `ai-agent-chat-with-tools`
- **Version Tag:** 3.2

#### Architecture B — Modular (`Backend/src/main/resources/bpmn/`)

The main router delegates to four separate deployed processes via **Call Activities**. Each agent is an independent process definition that can be versioned, deployed, and tested in isolation. BPMN files are under `Backend/src/main/resources/bpmn/`: `main-chat-router.bpmn`, `agent-user-data.bpmn`, `agent-utility.bpmn`, `agent-catering.bpmn`, and `agent-general.bpmn`. Processes can be deployed to the cluster via Camunda Web Modeler, CI/CD, or Zeebe classpath deployment.

- **Router Process ID:** `ai-agent-chat-router`
- **Version Tag:** 2.3
- **Child processes:** `ai-agent-user-data`, `ai-agent-utility`, `ai-agent-catering`, `ai-agent-general`

> **Note:** The repository also contains `agent-structured-response.bpmn` (`ai-agent-structured-response` v1.0), a Structured Response Analyst agent that returns JSON with `answer`, `key_points`, `confidence`, `sentiment`, and `category`. This agent is deployed independently but is not yet wired into the main router.

### 3.2 Main Process Flow

```mermaid
flowchart TD
    Start(["Message Start Event\nai-chat-start"])
    GwStartCont{"Start or\nContinue?"}
    Classify["AI Agent Task\nClassify Request Intent\nrouteCategory = LLM"]
    GwRoute{"Route by\ncategory"}
    UserData["Agent Subprocess\nUser Data"]
    Utility["Agent Subprocess\nUtility & Web"]
    Catering["Agent Subprocess\nCatering"]
    General["Agent Subprocess\nGeneral"]
    ErrBoundary["Boundary Error Event\n(per agent)"]
    HandleErr["Script Task\nHandle Agent Error"]
    GwMerge{"Merge\nResults"}
    GwWait{"Event-Based\nGateway"}
    MsgReply(["Intermediate Catch\nai-chat-user-reply\ncorrelation: sessionId"])
    Timer(["Timer\nPT30M"])
    EndTimeout(["End Event\nSession ended"])

    Start --> GwStartCont
    GwStartCont -->|"first turn"| Classify
    GwStartCont -->|"follow-up\nfollowUpInput"| Classify
    Classify --> GwRoute
    GwRoute -->|"user_data"| UserData
    GwRoute -->|"utility"| Utility
    GwRoute -->|"catering"| Catering
    GwRoute -->|"general"| General
    UserData --> GwMerge
    Utility --> GwMerge
    Catering --> GwMerge
    General --> GwMerge
    UserData --- ErrBoundary
    Utility --- ErrBoundary
    Catering --- ErrBoundary
    General --- ErrBoundary
    ErrBoundary --> HandleErr --> GwMerge
    GwMerge --> GwWait
    GwWait -->|"message received"| MsgReply --> GwStartCont
    GwWait -->|"no activity"| Timer --> EndTimeout
```

### 3.3 BPMN Elements Reference

#### Main Process (`ai-agent-chat-with-tools` / `ai-agent-chat-router`)

| Type | Name | ID | Purpose |
|------|------|----|---------|
| Message Start Event | Chat session started | `StartEvent_ChatSessionStarted` | Triggered by `ai-chat-start` message |
| Exclusive Gateway | Start / continue | `Gateway_StartOrContinue` | First turn vs follow-up routing |
| AI Agent Task (Service Task) | Classify Request Intent | `ClassifyRequestIntent` | AI-powered intent classification via LLM; outputs exactly one of `user_data`, `utility`, `catering`, `general` into `routeCategory` (no tools) |
| Call Activity | User Data Agent | `Call_UserData` | Calls `ai-agent-user-data` process to handle user data queries |
| Call Activity | Utility & Web Agent | `Call_Utility` | Calls `ai-agent-utility` process for date/time, math, URL fetch |
| Call Activity | Catering Agent | `Call_Catering` | Calls `ai-agent-catering` process for menu categories and dishes |
| Call Activity | General Agent | `Call_General` | Calls `ai-agent-general` process for knowledge answers |
| Boundary Error Event | Agent error | `Error_*` | Catches errors per agent call activity |
| Exclusive Gateway | Merge errors | `Gateway_MergeErrors` | Collects all agent errors |
| Script Task | Handle Agent Error | `HandleAgentError` | Formats error response in `agent` variable |
| Exclusive Gateway | Merge results | `Gateway_MergeResults` | Re-joins all paths (success or error) |
| Script Task | Store Conversation History | `StoreConversationHistory` | Appends current turn to conversation history; retains last 6 entries (3 exchanges) for cross-agent awareness |
| Event-Based Gateway | Wait for user or timeout | `EventGateway_Wait` | Waits for reply or inactivity |
| Intermediate Message Catch | User sends next message | `MessageCatchEvent_UserReply` | `ai-chat-user-reply`, key: `sessionId` |
| Intermediate Timer Catch | 30 min inactivity | `TimerEvent_Timeout` | `PT30M` ISO duration |
| End Event | Session ended (inactivity) | `EndEvent_Timeout` | Terminal state |

#### Modular Architecture — Process List

| Process ID | Version | Purpose |
|------------|---------|--------|
| `ai-agent-chat-router` | 2.3 | Main orchestration process; classifies intent and routes to specialized agents |
| `ai-agent-user-data` | 1.0 | User data lookups (list users, load user by ID) |
| `ai-agent-utility` | 1.0 | Utility operations (date/time, math, URL fetch) |
| `ai-agent-catering` | 1.0 | Catering menu (categories and dishes via job workers) |
| `ai-agent-general` | 1.0 | General knowledge and conversational queries |
| `ai-agent-structured-response` | 1.0 | Structured response analysis (JSON output); not yet wired into router |


### 3.4 AI Agent Architecture

Specialized agent subprocesses (`ai-agent-user-data`, `ai-agent-utility`, `ai-agent-catering`, `ai-agent-general`) use the **AI Agent Job Worker** connector (`io.camunda.agenticai:aiagent-job-worker:1`) from Camunda, configured with:

- **Provider:** AWS Bedrock (Claude 3.5 Haiku)
- **Memory:** In-process storage; subprocess agents use a **20-entry** context window (the main router’s **Classify Request Intent** task uses a smaller window — see BPMN)
- **Tool Call Behavior:** `WAIT_FOR_TOOL_CALL_RESULTS` — agent can make multiple tool calls and receives results
- **Response Formatting:** Markdown or structured text; the Catering agent is configured for JSON-shaped replies in BPMN
- **Context Retention:** Each agent maintains its own context variable (`userDataAgentCtx`, `utilityAgentCtx`, `cateringAgentCtx`, `generalAgentCtx`) for conversation awareness across turns

Each agent receives:
1. **User message** (`currentInput`) — current or follow-up user query
2. **Conversation history** (`conversationHistory`) — last 6 entries (3 exchanges) from across all agents
3. **Document attachments** (`inputDocuments`, `followUpDocuments`) — optional user uploads
4. **Agent context** (`agentContext`) — prior state/memory for that agent
5. **Provider config** (`providerConfig`) — Bedrock region, auth, model specification

### 3.5 Agent Tools and Configuration

#### Set Provider Config (Main Router)

| Task | Type | Configuration |
|------|------|-------|
| SetProviderConfig | Script Task | Sets AWS Bedrock region (`us-east-1`), authentication type (`credentials`), and model (`us.anthropic.claude-3-5-haiku-20241022-v1:0`); determines `currentInput` from either `inputText` (first turn) or `followUpInput` (subsequent turns) |

#### User Data Agent (`ai-agent-user-data`)

| Task | Connector | Endpoint | Method | Purpose |
|------|-----------|----------|--------|---------|
| ListUsers | Zeebe job worker `list-users-worker` | Backend `ListUsersWorker` | — | Returns static user list as `toolCallResult` for AI Agent connector |
| LoadUserByID | `io.camunda:http-json:1` | `https://jsonplaceholder.typicode.com/users/{id}` | GET | Fetch single user |

#### Utility & Web Agent (`ai-agent-utility`)

| Task | Connector / Type | Expression / Endpoint | Purpose |
|------|------------------|-----------------------|---------|
| GetDateAndTime | Script Task (FEEL) | `=now()` → `toolCallResult` | Current date and time |
| SuperfluxProduct | Script Task (FEEL) | `=3 * (inputA + inputB)` | Custom math operation |
| Fetch_URL | `io.camunda:http-json:1` | Dynamic URL from AI | Fetch arbitrary web content |

#### General Agent (`ai-agent-general`)

| Task | Type | Purpose |
|------|------|---------|
| KnowledgeAnswer | Script Task (placeholder) | Placeholder tool; General Agent answers from knowledge only (no external tools needed) |

#### Catering Agent (`ai-agent-catering`)

| Task | Connector / Type | Endpoint / Input | Purpose |
|------|------------------|------------------|---------|
| Get Menu Categories | Zeebe job worker `get-menu-categories-worker` | Backend `GetMenuCategoriesWorker` | Returns menu categories (id, label, description) as `toolCallResult` |
| Get Dishes by Category | Zeebe job worker `get-dishes-by-category-worker` | Backend `GetDishesByCategoryWorker` | Variable `categoryId`; returns dishes for that category from the menu API |

### 3.6 BPMN Variables

| Variable | Direction | Set By | Consumed By |
|----------|-----------|--------|-------------|
| `sessionId` | Input | Backend (`startSession`) | Message correlation | Unique session identifier; correlation key for replies |
| `inputText` | Input | Backend (`startSession`) | SetProviderConfig | Initial user message on first turn |
| `followUpInput` | Input | Backend (`sendReply`) | SetProviderConfig | User's follow-up message on subsequent turns |
| `currentInput` | Internal | SetProviderConfig script | ClassifyRequestIntent, all agents | Current message text (either `inputText` or `followUpInput`) |
| `inputDocuments` | Input | Backend | All agents | Document attachments from initial message (currently empty list) |
| `followUpDocuments` | Input | Backend | All agents | Document attachments from follow-up (currently empty list) |
| `providerConfig` | Internal | SetProviderConfig script | ClassifyRequestIntent agent, all subprocesses | `{type, region, authType, model}` — Bedrock configuration |
| `routeCategory` | Internal | ClassifyRequestIntent | Routing gateway | `user_data`, `utility`, `catering`, or `general` — AI classifier result |
| `classifierAgentCtx` | Internal | ClassifyRequestIntent | ClassifyRequestIntent (next turn) | Classifier's internal memory for context-aware classification across turns |
| `conversationHistory` | Internal | StoreConversationHistory script | All agents | List of last 6 conversation entries (3 exchanges); format: `["User: ... | agent: ..."]` |
| `userDataAgentCtx` | Internal | User Data Agent subprocess | User Data Agent (next turn) | User Data Agent's context memory |
| `utilityAgentCtx` | Internal | Utility Agent subprocess | Utility Agent (next turn) | Utility Agent's context memory |
| `generalAgentCtx` | Internal | General Agent subprocess | General Agent (next turn) | General Agent's context memory |
| `cateringAgentCtx` | Internal | Catering Agent subprocess | Catering Agent (next turn) | Catering Agent's context memory |
| `agent` | Output | Agent subprocess | Backend | `{responseText, context, conversation, ...}` — final response text and agent state |
| `toolCallResults` | Internal | Agent subprocess (ad-hoc) | Agent Connector | Collects tool call results within agent |
| `agentContext` | Internal | Agent subprocess input | Agent Connector | Agent's context state for multi-turn awareness |

### 3.7 Conversation History and Multi-Turn Context

The **Store Conversation History** task maintains a shared conversation log across all agent calls within a single session. This enables:

- **Cross-agent context:** Each agent receives the last 6 conversation entries (3 exchanges) so it understands previous decisions and responses from other agents
- **Context window management:** Entries are truncated (max 200 chars per agent response) to stay within token limits
- **Turn tracking:** Each entry is formatted as `"User: <message> | <agent_category> agent: <response_summary>"`
- **Stateless classifier:** The intent classifier can use conversation history to make context-aware routing decisions on follow-up queries

**Example conversation history after 2 exchanges:**

```
[
  "User: List all users | user_data agent: Here are the users: [1] Bret, [2] Antonette, ...",
  "User: Tell me about user 1 | user_data agent: Bret is a software engineer with email bret@gmail.com",
    "User: What time is it? | utility agent: It is currently 15:30."
]
```

Each agent also maintains its own context variable (`userDataAgentCtx`, `utilityAgentCtx`, `cateringAgentCtx`, `generalAgentCtx`) for internal state that persists across turns of the same category.

### 3.8 FEEL expression rules in BPMN

All `zeebe:input` and `zeebe:script` expressions use **Camunda FEEL**. To keep prompts and expressions valid and XML-safe:

- **XML escaping:** In attribute values, escape `<` as `&#60;` and `>` as `&#62;` (e.g. `count(list) &#62; 0`, or literal “&lt;thinking&gt;” in prompt text). This avoids the XML parser misreading comparison operators or angle brackets.
- **FEEL string literals:** Strings are double-quoted in FEEL. Inside a string, a literal double-quote must be escaped as `\"`. Apostrophes in prompt text can stay as `'` or be written as `&#39;` in the XML. Newlines in prompts use `&#10;`.
- **Consistency:** User-prompt and system-prompt expressions (e.g. conversation history + `currentInput`) use the same pattern: `(if (is defined(conversationHistory) and conversationHistory != null and count(conversationHistory) &#62; 0) then "..." + string join(...) + "..." else "") + currentInput`, with inner quotes as `&quot;` or `&#34;` in the XML so the FEEL engine receives valid string concatenation.

---

## 4. Backend Architecture

### 4.1 Package Dependency Diagram

```mermaid
graph TD
    controller["controller\nChatController"]
    service["service\nCamundaChatService\nSseStreamOrchestrator"]
    camunda["camunda\nCamundaRestClient\nMessagePublisher"]
    repository["repository\nSessionRepository"]
    model["model\nSessionState"]
    dto["dto\n5 records"]
    exception["exception\nApiException\nGlobalExceptionHandler\n3 domain exceptions"]
    config["config\nWebConfig\nClusterRestClientConfig"]
    worker["worker\nListUsersWorker\nGetMenuCategoriesWorker\nGetDishesByCategoryWorker"]

    controller --> service
    controller --> dto
    controller --> exception
    service --> camunda
    service --> repository
    service --> model
    service --> dto
    service --> exception
    config --> camunda
    repository --> model
    repository --> exception
```

### 4.2 Package Responsibilities

| Package | Classes | Responsibility |
|---------|---------|----------------|
| `com.example.aichat` | `CamundaChatApplication` | Spring Boot entry point; enables scheduling |
| `com.example.aichat.controller` | `ChatController` | HTTP entry points; input validation; delegates to `CamundaChatService` |
| `com.example.aichat.service` | `CamundaChatService`, `SseStreamOrchestrator` | Business logic; session lifecycle; response resolution; variable mapping; SSE stream lifecycle |
| `com.example.aichat.camunda` | `CamundaRestClient`, `MessagePublisher` | Cluster REST API v2 (variables, process instances, flow nodes); Zeebe publish/correlate |
| `com.example.aichat.worker` | `ListUsersWorker`, `GetMenuCategoriesWorker`, `GetDishesByCategoryWorker` | Zeebe job workers for AI Agent tools; return `toolCallResult` (and variables as needed) |
| `com.example.aichat.repository` | `SessionRepository` | In-memory session storage (`ConcurrentHashMap`) with scheduled expiry cleanup |
| `com.example.aichat.model` | `SessionState` | Mutable, thread-safe chat session state |
| `com.example.aichat.dto` | 5 records | Immutable request/response contracts |
| `com.example.aichat.exception` | `ApiException` (abstract), `GlobalExceptionHandler`, 3 domain exceptions | Base exception with errorCode/httpStatus; centralized exception-to-HTTP mapping |
| `com.example.aichat.config` | `WebConfig`, `ClusterRestClientConfig` | CORS, security headers filter, stream scheduler; OAuth2 token + `RestClient` for Cluster REST API |

---

## 5. Backend Component Details

### 5.1 ChatController

`@Validated @RestController @RequestMapping("/api/chat")`

| Method | Path | Request Body | Response Body | Success | Notes |
|--------|------|--------------|---------------|---------|-------|
| POST | `/start` | `StartChatRequest` | `StartChatResponse` | 200 | Starts new session; correlates start message |
| GET | `/{sessionId}/response` | — | `ChatResponseDTO` | 200 | Fallback polling endpoint |
| POST | `/{sessionId}/reply` | `ReplyRequest` | — | 200 | Publishes follow-up message |
| GET | `/{sessionId}/stream` | — | SSE stream of `ChatResponseDTO` events | 200 | Primary response channel; see note below |

All `{sessionId}` path variables are validated with `@NotBlank`. Request bodies are validated with `@Valid`.

**SSE opening errors:** For `GET /{sessionId}/stream`, `SessionNotFoundException` and `SessionExpiredException` are handled inside the controller (not by `GlobalExceptionHandler`). The response is still **HTTP 200** with `Content-Type: text/event-stream`: a single SSE `data:` event containing a JSON `ChatResponseDTO` — `status: "error"` with the exception message (not found), or `status: "expired"` with `"Session expired."` — then the emitter completes. Other endpoints return standard JSON error bodies for 404/410.

### 5.2 CamundaChatService

`@Service` class. Orchestrates session lifecycle, response resolution, and variable mapping; delegates SSE streaming to `SseStreamOrchestrator`.

**Dependencies:** `CamundaRestClient`, `MessagePublisher`, `SessionRepository`, `SseStreamOrchestrator` (all concrete classes).

#### `startSession(String inputText)`

1. Generates a random UUID as `sessionId`.
2. Builds variables map: `sessionId`, `inputText`, `inputDocuments` (empty list).
3. Calls `messagePublisher.correlate(startMessageName, "", variables)` — synchronous gRPC call that returns `processInstanceKey`.
4. Constructs and persists a new `SessionState` via `sessionStore.save(session)`.
5. Returns the `SessionState` (sessionId + processInstanceKey exposed to frontend).

#### `getResponse(String sessionId)`

Reads current process state and translates it to a `ChatResponseDTO`:

1. Retrieves `SessionState` from `sessionStore.getActiveSession(sessionId)`.
2. Calls `camundaRestClient.fetchProcessInstanceVariables(processInstanceKey)`.
3. If variables are **empty**: calls private `handleEmptyVariables(session)` (empty poll counter, terminal-state check, expiry).
4. If variables are **present**: uses `extractRouteCategory(variables)`, `extractResponseText(agentVar)`, and `resolveAgentLabel(routeCategory)`. **`extractResponseText`** prefers `agent.responseText`; if blank, it walks **`agent.conversation.messages`** (last assistant content or `tool_call_result` content) so a response is still surfaced when the model finishes via tools without a top-level `responseText`.
5. **`resolveAgentLabel`** maps `user_data`, `utility`, and `general` to friendly names via `AGENT_LABELS`. The category **`catering`** is not in that map — **`handledBy` is the trimmed `routeCategory` string (`"catering"`)** unless you extend the map in code to e.g. `"Catering Agent"`.
6. Calls `session.checkAndAcceptNewResponse(...)` to atomically detect a new response (uses `agentVar.hashCode()` as `agentHash`).
7. If stale-poll threshold reached: calls private `handleStaleResponse(...)` (flow-node/terminal check).
8. Otherwise: calls private `lastKnownOrProcessing(session)`.
9. On 3+ consecutive errors: returns status `"error"`.

#### `sendReply(String sessionId, String followUpInput)`

1. Validates session via `sessionStore.getActiveSession(sessionId)`.
2. Calls `messagePublisher.publish(replyMessageName, sessionId, variables)` — `sessionId` is the correlation key.
3. Sets `session.awaitingResponse = true`.
4. On publish failure: uses `camundaRestClient.isProcessInstanceInState(...)` for terminal check; throws `SessionExpiredException` if terminal, otherwise re-throws.

#### `streamResponse(String sessionId)`

Delegates to `sseStreamOrchestrator.streamResponse(sessionId)`, which creates the `SseEmitter`, schedules the poll loop (calling `getResponse()` at fixed intervals), and handles completion/cleanup.

### 5.3 MessagePublisher

`@Component` in package `com.example.aichat.camunda` — single point for all Zeebe message operations.

| Method | Zeebe Command | Correlation Key | TTL | Returns | Used For |
|--------|---------------|-----------------|-----|---------|----------|
| `publish()` | `newPublishMessageCommand()` | `sessionId` | 30s | void | Follow-up replies to intermediate catch events |
| `correlate()` | `newCorrelateMessageCommand()` | `""` (empty) | — | `long processInstanceKey` | Start message — synchronous, strongly consistent |

**`publish()` vs `correlate()`:** `publish()` buffers the message in Zeebe for the TTL duration if no subscription exists yet. `correlate()` requires an active subscription and fails immediately if none exists — this is correct for start events since the process is guaranteed to have a waiting message start event when deployed. `correlate()` returns the `processInstanceKey` synchronously, eliminating the need for subsequent polling to find the started instance.

### 5.4 CamundaRestClient

`@Component` in package `com.example.aichat.camunda` — all Camunda Cluster REST API v2 HTTP calls.

#### Camunda API Calls

| Method | HTTP | Endpoint | Purpose |
|--------|------|----------|---------|
| `fetchProcessInstanceVariables()` | POST | `/v2/variables/search` | Fetch variables (`agent`, `routeCategory`) for response resolution |
| `searchProcessInstances()` | POST | `/v2/process-instances/search` | Filter process instances by state/key |
| `isProcessInstanceInState()` | POST | `/v2/process-instances/search` (×N states) | Check if instance is COMPLETED or CANCELED |
| `fetchFullVariableValue()` (private) | GET | `/v2/variables/{variableKey}` | Fetch full (non-truncated) variable value |

#### Variable Resolution Logic

Camunda's variables API may return truncated values for large variables. `CamundaRestClient` handles this transparently:

1. Checks `isTruncated` flag on each variable node.
2. If truncated: fetches the full value via `GET /v2/variables/{variableKey}`.
3. Prefers `fullValue` field over `value` field when present.
4. Parses string values as JSON where possible (for nested objects like `agent`).

All requests use a configurable read timeout (default 30 seconds, via `app.camunda.cluster-api-timeout-seconds`) configured on the underlying `JdkClientHttpRequestFactory`.

### 5.5 ClusterRestClientConfig

`@Configuration` in package `com.example.aichat.config` — produces the `clusterRestClient` Spring bean.

- Builds a `RestClient` with `clusterApiUrl` as base URL, backed by `JdkClientHttpRequestFactory` (`java.net.http.HttpClient`) with:
  - Read timeout: configurable (default 30 seconds, via `app.camunda.cluster-api-timeout-seconds`)
  - Connection timeout: 5 seconds
- Attaches a `ClientHttpRequestInterceptor` that injects a Bearer token before every request.

#### OAuth2 Token Management

```
getAccessToken() [synchronized]
├── Token cached and not expired? → return cached token
└── Expired or absent
    ├── POST {authTokenUrl}
    │   Content-Type: application/x-www-form-urlencoded
    │   Body: grant_type=client_credentials
    │         client_id={clientId}
    │         client_secret={clientSecret}
    │         audience=zeebe.camunda.io
    ├── Cache access_token
    └── Set expiry = now() + expires_in - 60s (60s safety buffer)
```

Token caching is synchronized on the `ClusterRestClientConfig` instance. The auth token request itself uses a separate short-lived `RestClient` (10-second timeout). The 60-second buffer ensures the main token is refreshed before it actually expires.

### 5.6 SessionRepository

`@Repository` — in-memory `ConcurrentHashMap<String, SessionState>`.

| Operation | Method | Behavior |
|-----------|--------|----------|
| Store session | `save(SessionState)` | Puts by `sessionId` key |
| Retrieve active | `getActiveSession(String)` | Returns session; throws `SessionNotFoundException` if absent; throws `SessionExpiredException` if `session.isExpired()` |
| Cleanup | `cleanupExpiredSessions()` | `@Scheduled` every 5 minutes; removes entries where `isExpired() == true` OR `createdAt` is before the max-age cutoff |

Sessions are never evicted mid-stream; they age out naturally 30 minutes after creation or are explicitly marked expired by `CamundaChatService`.

### 5.7 Zeebe Job Workers (AI Agent Tools)

The backend registers Zeebe job workers that implement AI Agent tool tasks. When a BPMN agent subprocess invokes a tool (e.g. "List users"), Zeebe creates a job that the worker completes and returns a `toolCallResult` for the AI Agent connector.

| Worker | Job Type | Purpose |
|--------|----------|---------|
| `ListUsersWorker` | `list-users-worker` | Returns a static list of users (id, name, username, email) as `toolCallResult` for the User Data Agent |
| `GetMenuCategoriesWorker` | `get-menu-categories-worker` | Fetches menu categories from the configured menu API; returns `toolCallResult` for the Catering Agent |
| `GetDishesByCategoryWorker` | `get-dishes-by-category-worker` | Reads `categoryId` from the job; fetches dishes for that category; returns `toolCallResult` for the Catering Agent |

Workers use `@JobWorker(..., autoComplete = true, fetchAllVariables = false)` and are registered automatically by the Camunda Spring Boot starter.

### 5.8 SessionState

Mutable, thread-safe domain model. All state-mutating methods are `synchronized`.

| Field | Type | Initial Value | Purpose |
|-------|------|---------------|---------|
| `sessionId` | String | UUID | Unique session identifier |
| `processInstanceKey` | String | From `correlate()` | Links session to Camunda process instance |
| `createdAt` | Instant | `Instant.now()` | Used for max-age cleanup |
| `awaitingResponse` | boolean | `true` | Tracks whether a new AI response is expected |
| `lastResponseText` | String | null | Last confirmed AI response text |
| `lastHandledBy` | String | null | Agent label for last response |
| `lastAgentHash` | int | 0 | Hash of last accepted agent variable; used with text to detect new response |
| `consecutiveEmptyPolls` | int | 0 | Reset on any variable data; triggers expiry check at threshold |
| `consecutiveStalePollsWhileAwaiting` | int | 0 | Incremented when `awaitingResponse` and response text/hash unchanged; triggers gateway check at threshold |
| `consecutiveErrors` | int | 0 | Reset on success; triggers error response at 3 |
| `expired` | boolean | false | Set on process termination |
| `pollInProgress` | `AtomicBoolean` | false | Used with `tryStartPoll` / `endPoll` so overlapping SSE poll ticks do not run `getResponse` concurrently for the same session |

#### Concurrent poll coalescing (`tryStartPoll` / `endPoll`)

`SseStreamOrchestrator` calls `session.tryStartPoll()` before each `getResponse` and `endPoll()` in a `finally` block. If a poll is already in progress, the tick returns early so only one Cluster REST resolution runs at a time per session.

#### `checkAndAcceptNewResponse(currentResponseText, handledBy, agentHash)` — Atomic Detection

This synchronized method prevents duplicate response delivery:

1. Returns `null` if `currentResponseText` is blank.
2. If `awaitingResponse` is **false**, returns `null` (nothing to accept for this turn).
3. If `awaitingResponse` is **true** and either response text or `agentHash` differs from the last accepted values, treats this as a **new response**: updates `lastResponseText`, `lastHandledBy`, `lastAgentHash`, sets `awaitingResponse = false`, resets `consecutiveEmptyPolls` and `consecutiveStalePollsWhileAwaiting`, and returns the new text.
4. If `awaitingResponse` is **true** and both text and `agentHash` are unchanged, increments **`consecutiveStalePollsWhileAwaiting`** and returns `null`.

`forceAcceptCurrentResponse(...)` (used after flow-node checks) sets state as in step 3 without requiring text/hash change.

### 5.9 ApiException and GlobalExceptionHandler

`ApiException` is an abstract base class for all domain exceptions, carrying `errorCode` (String) and `httpStatus` (HttpStatus). `ProcessStartException`, `SessionExpiredException`, and `SessionNotFoundException` extend it.

`GlobalExceptionHandler` (`@RestControllerAdvice`) maps all exceptions to structured JSON error responses. Domain exceptions are handled uniformly by `handleApiException(ApiException)`, which logs WARN for 4xx and ERROR for 5xx based on `httpStatus`.

| Exception | HTTP Status | Error Code |
|-----------|-------------|------------|
| `SessionNotFoundException` | 404 Not Found | `session_not_found` |
| `SessionExpiredException` | 410 Gone | `session_expired` |
| `ProcessStartException` | 503 Service Unavailable | `process_start_failed` |
| `MethodArgumentNotValidException` | 400 Bad Request | `validation_error` |
| `ConstraintViolationException` | 400 Bad Request | `validation_error` |
| `IllegalArgumentException` | 400 Bad Request | `invalid_request` |
| `HttpMessageNotReadableException` | 400 Bad Request | `invalid_request` |
| `MethodArgumentTypeMismatchException` | 400 Bad Request | `invalid_request` |
| `RestClientResponseException` | 502 Bad Gateway | `upstream_error` |
| `RuntimeException` | 500 Internal Server Error | `internal_error` |
| `Exception` | 500 Internal Server Error | `internal_error` |

All responses use `ErrorResponse(String error, String message)`. The handler logs **WARN** for 4xx (session not found, expired, validation) and **ERROR** for 5xx and process start failures.

### 5.10 Logging

Backend logging uses SLF4J with a simple console pattern: `%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n`.

| Component | Level | Events |
|-----------|--------|--------|
| **ChatController** | INFO | Chat started (sessionId, processInstanceKey); reply sent (sessionId); WARN when SSE stream rejected (session not found/expired) |
| **CamundaChatService** | INFO | SSE stream opened (sessionId); published reply (message name, sessionId); stream error (WARN); persistent/transient response errors (WARN/ERROR); stale-polls gateway check |
| **SessionRepository** | INFO | Cleanup (removed count, remaining) |
| **GlobalExceptionHandler** | WARN | Session not found, session expired, validation errors; ERROR for process start, upstream, runtime |
| **ClusterRestClientConfig** | INFO | OAuth token fetch and expiry |
| **CamundaRestClient** | ERROR/WARN | Process instance search failure; variable fetch failure; full-value fetch failure |

Set `logging.level.com.example.aichat: DEBUG` for more detail (e.g. per-poll or variable fetch).

### 5.11 DTOs

All DTOs are Java records (immutable).

| Record | Fields | Validation |
|--------|--------|------------|
| `StartChatRequest` | `inputText` | `@NotBlank`, `@Size(max=4000)` |
| `StartChatResponse` | `sessionId`, `processInstanceKey` | — |
| `ReplyRequest` | `followUpInput` | `@NotBlank`, `@Size(max=4000)` |
| `ChatResponseDTO` | `status`, `responseText`, `handledBy` | — |
| `ErrorResponse` | `error`, `message` | — |

#### ChatResponseDTO Status Values

| Status | Meaning | `responseText` |
|--------|---------|----------------|
| `processing` | Camunda process is still running | null |
| `ready` | AI response available | The response text |
| `error` | Persistent error after 3 retries | Error description |
| `expired` | Process instance completed/timed out | `"Session expired."` |

---

## 6. Chat Session Lifecycle

### 6.1 Full Happy-Path Sequence

```mermaid
sequenceDiagram
    actor User
    participant FE as "React Frontend"
    participant BE as "Spring Boot Backend"
    participant ZB as "Zeebe gRPC"
    participant CA as "Cluster REST API v2"
    participant CP as "Camunda Process"
    participant EXT as "External API"

    User->>FE: Type message, click Send
    FE->>BE: POST /api/chat/start\n{inputText}
    BE->>ZB: correlateMessage(ai-chat-start)\nvariables: {sessionId, inputText, inputDocuments}
    ZB-->>BE: processInstanceKey (synchronous)
    BE->>BE: SessionRepository.save(session)
    BE-->>FE: 200 {sessionId, processInstanceKey}

    FE->>BE: GET /api/chat/{sessionId}/stream\n(EventSource opened)
    BE->>BE: SseEmitter created\nscheduleAtFixedRate(app.polling.interval-ms)

    CP->>CP: ClassifyRequest (FEEL)
    CP->>CP: Route to agent subprocess
    CP->>EXT: HTTP Connector call\n(users, etc.)
    EXT-->>CP: Tool result
    CP->>CP: AI Agent processes result
    CP->>CP: Set agent.responseText variable

    loop Every ~1 second until ready
        BE->>CA: POST /v2/variables/search\n{processInstanceKey}
        CA-->>BE: variables (or empty)
        BE->>BE: checkAndAcceptNewResponse()
        alt Still processing
            BE->>FE: SSE event: {status: "processing"}
        else Response ready
            BE->>FE: SSE event: {status: "ready", responseText, handledBy}
        end
    end

    FE->>FE: EventSource.close()
    FE->>User: Display AI response

    User->>FE: Type follow-up
    FE->>BE: POST /api/chat/{sessionId}/reply\n{followUpInput}
    BE->>ZB: publishMessage(ai-chat-user-reply)\ncorrelationKey: sessionId
    ZB-->>BE: ack
    BE->>BE: session.awaitingResponse = true
    BE-->>FE: 200

    FE->>BE: GET /api/chat/{sessionId}/stream\n(new EventSource)
    Note over BE,CP: Process loops: EventGateway receives\nmessage, re-routes to ClassifyRequest
    BE->>FE: SSE event: {status: "ready", ...}
    FE->>FE: EventSource.close()
    FE->>User: Display follow-up response

    Note over CP: 30 min inactivity
    CP->>CP: Timer fires → EndEvent
    BE->>CA: POST /v2/variables/search (empty)
    BE->>CA: POST /v2/process-instances/search\n{state: "COMPLETED"}
    CA-->>BE: instance found
    BE->>FE: SSE event: {status: "expired"}
    FE->>User: "Session expired" message
```

---

## 7. Server-Sent Events Flow

### 7.1 SSE Architecture

SSE is the primary channel for delivering AI responses to the browser. The backend creates a long-lived HTTP connection and pushes JSON events whenever the process state changes.

### 7.2 Backend SSE Lifecycle

The backend polls the **Cluster REST API** on a fixed schedule (`app.polling.interval-ms`, default 1000ms). **`SseStreamOrchestrator`** creates the `SseEmitter`, validates the session, and schedules **`CamundaChatService.getResponse()`** on each tick (subject to **`tryStartPoll` / `endPoll`** so only one in-flight poll runs per session). Separately, when the latest DTO is **`processing`** and the session has more than **10** consecutive empty polls, **`SseStreamOrchestrator`** may **skip sending** some SSE `data:` events (modulo `app.polling.idle-interval-multiplier`) to reduce browser/UI churn. **That throttle does not reduce Cluster REST API calls** — each scheduled tick still invokes `getResponse()` unless the previous poll has not finished.

```mermaid
sequenceDiagram
    participant FE as "EventSource\n(Browser)"
    participant CTRL as "ChatController"
    participant ORCH as "SseStreamOrchestrator"
    participant SVC as "CamundaChatService"
    participant SCHED as "ScheduledExecutorService"
    participant CA as "Cluster REST API"

    FE->>CTRL: GET /{sessionId}/stream\nAccept: text/event-stream
    CTRL->>ORCH: streamResponse(sessionId)
    ORCH->>ORCH: getActiveSession, new SseEmitter(emitterTimeoutMs)
    ORCH->>SCHED: scheduleAtFixedRate(poll, 0, pollingIntervalMs, MILLISECONDS)
    Note over SCHED: Default 1000ms = up to 1 variable search/sec per session<br/>if each poll finishes within the interval
    ORCH-->>CTRL: SseEmitter
    CTRL-->>FE: HTTP 200\nContent-Type: text/event-stream\n(connection held open)

    loop Each polling interval
        SCHED->>ORCH: poll tick
        ORCH->>ORCH: tryStartPoll (skip tick if busy)
        ORCH->>SVC: getResponse(sessionId)
        SVC->>CA: POST /v2/variables/search
        CA-->>SVC: variables
        SVC-->>ORCH: ChatResponseDTO
        alt processing, empty polls > 10, throttle modulo
            ORCH->>ORCH: May skip emitter.send (no API savings)
        else send to client
            ORCH->>FE: data: ChatResponseDTO JSON\n\n
        end
        alt status terminal ready, error, expired
            ORCH->>ORCH: complete emitter, cancel future
        end
        ORCH->>ORCH: endPoll
    end

    Note over FE: emitter timeout (e.g. 10 min) → onTimeout → cancel future
```

**Polling and SSE behavior:**
- **Cluster REST load:** Driven by **`interval-ms`** and session count (each tick calls `getResponse` → variables search, unless the previous poll is still running).
- **SSE event rate:** Can be lower than the poll rate when **`processing`** and empty-poll throttling applies — fewer duplicate `"processing"` pushes to the browser, not fewer Camunda requests.
- **Idle multiplier:** Only affects **whether `emitter.send` runs** on a tick when status is `processing` and empty polls > 10; it is **not** an API backoff.

### 7.3 Frontend EventSource Lifecycle

```mermaid
sequenceDiagram
    participant ChatWindow
    participant ES as "EventSource"
    participant API as "api.js"

    ChatWindow->>API: createResponseStream(sessionId)
    API->>ES: new EventSource(url)
    ES-->>ChatWindow: es reference stored in esRef

    loop Incoming SSE events
        ES->>ChatWindow: onmessage(event)
        ChatWindow->>ChatWindow: JSON.parse(event.data)
        alt data.status = "ready"
            ChatWindow->>ES: es.close()
            ChatWindow->>ChatWindow: addMessage('ai', responseText, handledBy)
            ChatWindow->>ChatWindow: setPhase('ready')
        else data.status = "error"
            ChatWindow->>ES: es.close()
            ChatWindow->>ChatWindow: setError(responseText)
            ChatWindow->>ChatWindow: setPhase('ready')
        else data.status = "expired"
            ChatWindow->>ES: es.close()
            ChatWindow->>ChatWindow: handleSessionExpired()
        end
    end

    alt Connection error (transient)
        ES->>ChatWindow: onerror (readyState = CONNECTING)
        Note over ES: EventSource auto-reconnects
    else Connection closed permanently
        ES->>ChatWindow: onerror (readyState = CLOSED)
        ChatWindow->>ChatWindow: setError('Connection lost.')
        ChatWindow->>ChatWindow: setPhase('ready')
    end

    Note over ChatWindow: On unmount
    ChatWindow->>ES: esRef.current.close()
```

### 7.4 SSE Event Format

Each SSE event sent by the backend:

```
data: {"status":"processing","responseText":null,"handledBy":null}

data: {"status":"ready","responseText":"Here are the users: ...","handledBy":"User Data Agent"}

data: {"status":"error","responseText":"Unable to retrieve response. Please try again.","handledBy":null}

data: {"status":"expired","responseText":"Session expired.","handledBy":null}
```

Each event is a single `data:` line followed by two newlines (`\n\n`), conforming to the SSE specification.

---

## 8. Message Correlation Flow

### 8.1 Start Message — `correlate()` (Synchronous)

```mermaid
sequenceDiagram
    participant SVC as "CamundaChatService"
    participant MP as "MessagePublisher"
    participant ZB as "Zeebe gRPC"
    participant CP as "BPMN Process"

    SVC->>MP: correlate("ai-chat-start", "", variables)
    MP->>ZB: newCorrelateMessageCommand()\n.messageName("ai-chat-start")\n.correlationKey("")\n.variables({sessionId, inputText, ...})\n.send().join(30s)
    ZB->>CP: Trigger Message Start Event
    CP-->>ZB: processInstanceKey
    ZB-->>MP: CorrelateMessageResponse
    MP-->>SVC: processInstanceKey (long)
    Note over SVC: session saved with processInstanceKey
```

**Why `correlate()` for start:** The Zeebe `newCorrelateMessageCommand` is synchronous and returns the `processInstanceKey` directly. This eliminates the need to poll the process instance search API after startup. If no matching message start event subscription exists (process not deployed), the call fails immediately with a clear error rather than timing out silently.

**Why empty correlation key `""`:** Message start events do not correlate to a running instance; they create one. The correlation key is irrelevant for start events and is passed as an empty string.

### 8.2 Reply Message — `publish()` (Buffered)

```mermaid
sequenceDiagram
    participant SVC as "CamundaChatService"
    participant MP as "MessagePublisher"
    participant ZB as "Zeebe gRPC"
    participant CP as "BPMN Process\n(waiting at EventGateway)"]

    SVC->>MP: publish("ai-chat-user-reply", sessionId, variables)
    MP->>ZB: newPublishMessageCommand()\n.messageName("ai-chat-user-reply")\n.correlationKey(sessionId)\n.variables({followUpInput, ...})\n.timeToLive(30s)\n.send().join(30s)
    ZB->>ZB: Buffer message (TTL: 30s)
    ZB->>CP: Correlate to MessageCatchEvent_UserReply\n(correlation key matches sessionId)
    CP->>CP: Resume from EventGateway_Wait
```

**Why `publish()` for replies:** The intermediate message catch event may not yet be active when the reply arrives (the process may still be completing its previous response cycle). `publish()` buffers the message in Zeebe for up to the TTL (30 seconds), ensuring it is delivered when the catch event becomes active.

---

## 9. Authentication and Security

### 9.1 OAuth2 Client Credentials Flow

```mermaid
sequenceDiagram
    participant WC as "ClusterRestClientConfig"
    participant AUTH as "Cloud Login\nlogin.cloud.camunda.io/oauth/token"
    participant API as "Cluster REST API v2"

    Note over WC: First request (or token expired)
    WC->>AUTH: POST /oauth/token\ngrant_type=client_credentials\nclient_id={CAMUNDA_CLIENT_ID}\nclient_secret={CAMUNDA_CLIENT_SECRET}\naudience=zeebe.camunda.io
    AUTH-->>WC: {access_token, expires_in}
    WC->>WC: Cache token\nexpiry = now() + expires_in - 60s

    WC->>API: Request + Authorization: Bearer {token}
    API-->>WC: Response

    Note over WC: Subsequent requests (token valid)
    WC->>WC: Return cached token
    WC->>API: Request + Authorization: Bearer {token}
    API-->>WC: Response

    Note over WC: Token within 60s of expiry
    WC->>AUTH: POST /oauth/token (refresh)
    AUTH-->>WC: New {access_token, expires_in}
```

The token fetch and caching in `getAccessToken()` are `synchronized`, making it safe for concurrent requests from multiple SSE poll threads.

### 9.2 CORS Configuration

Managed by `WebConfig`:

```
Mapping:      /api/**
Origins:      http://localhost:5173, http://127.0.0.1:5173
Methods:      GET, POST, OPTIONS
Headers:      Content-Type, Accept, X-Requested-With, Last-Event-ID
Credentials:  false
```

`Last-Event-ID` is included because browsers send this header automatically when an `EventSource` reconnects after a connection drop, allowing the server to resume from the last event (future capability).

### 9.3 Security Headers

Set by the `securityHeadersFilter()` bean in `WebConfig` on every response:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking via iframes |
| `Cache-Control` | `no-store` | Prevents sensitive API responses from being cached |

---

## 10. Frontend Architecture

### 10.1 Component Tree

```mermaid
graph TD
    main["main.jsx\nReactDOM.createRoot"]
    EB["ErrorBoundary\n(class component)"]
    App["App\nbackground layout"]
    CW["ChatWindow\nall chat state"]
    CI["ChatInput\nforwardRef textarea"]
    MB["MessageBubble\nmemo"]
    TI["ThinkingIndicator\ndots animation"]
    SI["SparkIcon\nSVG branding"]

    main --> EB --> App --> CW
    CW --> CI
    CW --> MB
    CW --> TI
    CW --> SI
```

### 10.2 ChatWindow State Machine

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> thinking: handleSendMessage()\nstartChat() called
    thinking --> ready: SSE "ready" event received
    thinking --> ready: SSE "error" event received
    thinking --> expired: SSE "expired" event\nor API 410 on start/reply
    ready --> thinking: handleSendMessage()\nsendReply() called
    ready --> idle: handleNewChat()
    expired --> idle: handleNewChat()
    idle --> idle: handleNewChat()
```

| Phase | UI Shown | Input Enabled |
|-------|----------|---------------|
| `idle` | Empty state, quick prompts | Yes |
| `thinking` | `ThinkingIndicator`, "working..." hint | No |
| `ready` | AI message bubble | Yes (for follow-up) |
| `expired` | System message, "Start new conversation" | No |

### 10.3 ChatWindow Key Logic

| Function | Trigger | Action |
|----------|---------|--------|
| `handleSendMessage(text)` | User submits input | If no session: `startChat()` then `startStreaming()`; if session: `sendReply()` then `startStreaming()` |
| `startStreaming(sid)` | After start or reply | Calls `stopStreaming()`, creates `EventSource`, stores in `esRef`, registers `onmessage`/`onerror` |
| `stopStreaming()` | On terminal SSE event, new chat, component unmount | Closes `EventSource`, nulls `esRef` |
| `handleSessionExpired()` | 410 error or `expired` SSE status | Calls `stopStreaming()`, sets phase `expired`, adds system message |
| `handleNewChat()` | New Chat button | Calls `stopStreaming()`, resets all state to initial values |
| `addMessage(role, text, handledBy)` | On AI response, user send, system event | Appends `{id, role, text, timestamp, handledBy}` to `messages` array |

### 10.4 MessageBubble

Renders differently by `role`:

| Role | Rendering | Special Processing |
|------|-----------|-------------------|
| `user` | Plain text, right-aligned bubble | None |
| `ai` | `react-markdown` with `remark-gfm` | Strips `<thinking>...</thinking>` tags; links open `target="_blank"` |
| `system` | Italic centered text | None |

The `handledBy` label (agent name) appears as a small badge below AI messages.

### 10.5 API Module (`api.js`)

| Export | Type | Purpose |
|--------|------|---------|
| `startChat(inputText)` | async function | POST `/start` |
| `sendReply(sessionId, followUpInput)` | async function | POST `/{sessionId}/reply` |
| `createResponseStream(sessionId)` | function | Returns `new EventSource(...)` for SSE |
| `ApiError` | class | Custom error: `status`, `errorCode`, `message` |

The backend also exposes **`GET /{sessionId}/response`** for snapshot polling; the React app does **not** wrap it — responses are delivered only via **`createResponseStream`** after start/reply.

All HTTP functions use `fetchWithTimeout()` with a 15-second `AbortController` timeout. Network errors and timeouts are normalized into `ApiError` instances.

---

## 11. REST API Reference

### Base URL

**Guest mode (anonymous):**
```
http://localhost:8085/api/v1/public/chatting
```

**Secure mode (JWT authenticated):**
```
http://localhost:8085/api/v1/secure/chatting
```

All requests in guest mode must include `clientId` (auto-generated UUID via `ankabut_guest_id` cookie).
All requests in secure mode must include `Authorization: Bearer <jwt-token>` header.

---

### Conversation Management

#### POST `/conversations`

Create a new conversation with an initial session.

**Request (Guest)**
```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "req": { "initialTitle": "My first chat" }
}
```

**Request (Secure)**
```json
{ "initialTitle": "My chat title" }
```

**Response — 201 Created**
```json
{
  "id": "conv-uuid",
  "conversationId": "conv-uuid",
  "sessionId": "sess-uuid",
  "processInstanceKey": "2251799813685324",
  "status": "ACTIVE",
  "startedAt": "2025-03-15T14:30:00Z"
}
```

---

### Session Orchestration

#### POST `/orchestration/sessions/{sessionId}/start`

Start the Camunda orchestration (agentic workflow) for a session.

**Request**
```json
{ "inputText": "Show me the catering menu" }
```

**Response — 200 OK**
```json
{
  "sessionId": "sess-uuid",
  "processInstanceKey": "2251799813685324"
}
```

---

#### POST `/orchestration/sessions/{sessionId}/user-messages`

Send a follow-up message within an active session.

**Request**
```json
{ "userInput": "What about pizza?" }
```

**Response — 200 OK** — empty or acknowledgment.

---

#### GET `/orchestration/sessions/{sessionId}/assistant-round/stream`

Open SSE stream for live agent responses.

**Response** — `Content-Type: text/event-stream`

```
data: {"status":"processing","message":null,"handledBy":null}

data: {"status":"ready","message":"Here are our pizza options: ...","handledBy":"Catering Agent"}

```

**Terminal statuses** (stream closes): `ready`, `error`, `expired`

**Invalid or expired session:** If the session is unknown or expired, **`ChatController`** still returns **HTTP 200** with `text/event-stream` and sends **one** SSE event with `status: "error"` (not found message) or `status: "expired"`, then completes — not a JSON `404`/`410` body. Use **`GET /response`** or start/reply endpoints for standard REST error JSON.

### 11.5 Frontend–Backend–BPMN Alignment

The following table ensures compatibility between the React frontend, Modulith API, and deployed BPMNs.

| Layer | Contract | Value / Shape |
|-------|----------|----------------|
| **BPMN messages** | Start message name | `ai-chat-start` (main-chat-router.bpmn `Message_ChatStart`) |
| | Reply message name | `ai-chat-user-reply` (main-chat-router.bpmn `Message_UserReply`) |
| | Reply correlation key | `sessionId` (variable on process) |
| **Frontend auth modes** | Guest | Auto-generated UUID in `ankabut_guest_id` cookie |
| | Secure | JWT token in `Authorization: Bearer` header |
| **Conversation API** | POST /conversations | Returns `{ sessionId, conversationId, processInstanceKey, status }` |
| **Orchestration API** | POST /orchestration/sessions/{id}/start | Request: `{ inputText }` |
| | POST /orchestration/sessions/{id}/user-messages | Request: `{ userInput }` |
| | GET /orchestration/sessions/{id}/assistant-round/stream | SSE stream of agent responses |
| **Start payload** | BPMN variables | `sessionId`, `inputText`, `inputDocuments` (list) |
| **Reply payload** | BPMN variables | `followUpInput`, `followUpDocuments` (list); correlation key = `sessionId` |
| **Process variables read** | For response resolution | `agent` (object with `responseText`), `routeCategory` (string) |
| **SSE Response** | Fields | `status` (processing|ready|error|expired), `message`, `handledBy` |
| **Error response** | Body | `{ "error": "error_code", "message": "description" }` |
| **Route categories** | Backend routing | `user_data` → User Data Agent, `utility` → Utility & Web Agent, `catering` → Catering Agent, `general` → General Agent |

Keep message names and variable names in sync when changing BPMNs; the Modulith Service translates REST requests into Zeebe messages automatically.

---

### Error Response Schema

All error responses share the same structure:

```json
{ "error": "error_code", "message": "Human-readable description" }
```

---

## 12. Error Handling

### 12.1 Backend Exception Mapping

All domain exceptions (`SessionNotFoundException`, `SessionExpiredException`, `ProcessStartException`) extend the abstract `ApiException` base class, which carries `errorCode` and `httpStatus`. The `GlobalExceptionHandler.handleApiException(ApiException)` method handles them uniformly, logging WARN for 4xx and ERROR for 5xx.

| Exception | Thrown By | HTTP | Error Code | Logged |
|-----------|-----------|------|------------|--------|
| `SessionNotFoundException` | `SessionRepository.getActiveSession()` | 404 | `session_not_found` | WARN |
| `SessionExpiredException` | `SessionRepository`, `CamundaChatService` | 410 | `session_expired` | WARN |
| `ProcessStartException` | `CamundaChatService.startSession()` | 503 | `process_start_failed` | ERROR |
| `MethodArgumentNotValidException` | Spring validation | 400 | `validation_error` | WARN |
| `ConstraintViolationException` | Spring validation | 400 | `validation_error` | WARN |
| `IllegalArgumentException` | — | 400 | `invalid_request` | WARN |
| `HttpMessageNotReadableException` | Jackson | 400 | `invalid_request` | WARN |
| `MethodArgumentTypeMismatchException` | Spring MVC | 400 | `invalid_request` | WARN |
| `RestClientResponseException` | `CamundaRestClient` | 502 | `upstream_error` | ERROR |
| `RuntimeException` | Any | 500 | `internal_error` | ERROR |
| `Exception` | Any | 500 | `internal_error` | ERROR |

### 12.2 Frontend Error Handling

**`ApiError` class** — thrown by `fetchWithTimeout()` and `handleResponse()`:

| Scenario | `status` | `errorCode` |
|----------|----------|-------------|
| HTTP 4xx/5xx | HTTP status code | From response body `error` field |
| Request timeout | 0 | `timeout` |
| Network error | 0 | `network_error` |

**`isSessionGone(err)`** — returns `true` if `errorCode === 'session_expired'` or `status === 410`. When true, `handleSessionExpired()` is called rather than showing a generic error.

**Error Banner** — displayed for transient errors (failed send, backend down, connection lost). Dismissible by the user. SSE connection errors (`onerror` when `CLOSED`) set the error banner.

**`ErrorBoundary`** — class component wrapping the entire app. Catches unhandled React render errors and shows a retry fallback UI, preventing a blank screen.

### 12.3 SSE Error Resilience

- **Transient network drop**: `EventSource` auto-reconnects (browser built-in). The backend stream is still running; the frontend will receive the next push event.
- **Permanent disconnect** (`readyState === CLOSED`): `onerror` handler shows "Connection lost" and sets phase to `ready`, allowing the user to retry.
- **Backend SSE poll error (non-IOException)**: `completeWithError()` is called, which triggers `onerror` in the browser.
- **Consecutive REST errors (≥3)**: `getResponse()` returns `status: "error"`, which terminates the SSE stream gracefully with an informative message.

---

## 13. Configuration Reference

### 13.1 Backend (`application.yaml`)

| Property | Value / Default | Description |
|----------|-----------------|-------------|
| `camunda.client.mode` | `saas` | Camunda client mode |
| `camunda.client.prefer-rest-over-grpc` | `false` | Prefer gRPC over REST for Zeebe communication |
| `camunda.client.auth.client-id` | `${CAMUNDA_CLIENT_ID}` | Zeebe client ID |
| `camunda.client.auth.client-secret` | `${CAMUNDA_CLIENT_SECRET}` | Zeebe client secret |
| `camunda.client.auth.token-url` | `https://login.cloud.camunda.io/oauth/token` | OAuth2 token endpoint |
| `camunda.client.grpc-address` | `grpcs://{clusterId}.{region}.zeebe.camunda.io:443` | Zeebe gRPC address |
| `camunda.client.rest-address` | `https://{region}.zeebe.camunda.io/{clusterId}` | Zeebe REST address |
| `camunda.client.cloud.cluster-id` | `${CAMUNDA_CLIENT_CLOUD_CLUSTERID}` | Cluster ID |
| `camunda.client.cloud.region` | `${CAMUNDA_CLIENT_CLOUD_REGION}` | Cluster region |
| `server.port` | `8081` | HTTP server port |
| `app.cors.allowed-origins` | `http://localhost:5173,http://127.0.0.1:5173` | CORS-allowed frontend origins |
| `app.sse.emitter-timeout-ms` | `600000` | SSE emitter timeout in milliseconds (10 minutes) |
| `app.camunda.cluster-api-url` | `https://{region}.zeebe.camunda.io/{clusterId}` | Base URL for Cluster REST API |
| `app.camunda.cluster-api-timeout-seconds` | `30` | Timeout for Cluster REST API calls (variable fetch, search) |
| `app.camunda.reply-catch-event-id` | `MessageCatchEvent_UserReply` | BPMN catch event ID for stale-poll resolution |
| `app.camunda.messages.start` | `ai-chat-start` | Zeebe message name for process start |
| `app.camunda.messages.reply` | `ai-chat-user-reply` | Zeebe message name for user replies |
| `app.camunda.messages.ttl-seconds` | `30` | TTL for published messages (seconds) |
| `app.polling.interval-ms` | `1000` | Base SSE polling interval in milliseconds (1 second = 1 API call/sec per session; optimized for Camunda) |
| `app.polling.idle-interval-multiplier` | `2.0` | When status is `processing` and empty polls > 10, only some ticks emit SSE events (modulo this factor); **does not** reduce Cluster REST API call frequency |
| `app.polling.empty-polls-before-expiry-check` | `60` | Consecutive empty variable polls before checking if process is terminal (60s at 1000ms interval) |
| `app.polling.stale-polls-before-gateway-check` | `30` | Stale polls before checking if process reached event-based gateway (30s at 1000ms interval) |
| `app.polling.max-consecutive-errors` | `3` | Consecutive REST errors before returning error status to client |
| `app.session.max-age-minutes` | `30` | Session max age before cleanup |
| `app.session.cleanup-interval-ms` | `300000` | Session cleanup interval (5 minutes) |
| `logging.pattern.console` | `%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n` | Console logging pattern (no MDC fields) |
| `logging.level.com.example.aichat` | `INFO` | Application log level |
| `logging.level.io.camunda` | `INFO` | Camunda SDK log level |

### 13.2 Backend Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CAMUNDA_CLIENT_ID` | Yes | OAuth2 client ID for Camunda SaaS |
| `CAMUNDA_CLIENT_SECRET` | Yes | OAuth2 client secret |
| `CAMUNDA_CLIENT_CLOUD_CLUSTERID` | Yes | Camunda cluster ID |
| `CAMUNDA_CLIENT_CLOUD_REGION` | Yes | Camunda cluster region (e.g. `bru-2`) |

Variables are loaded from a `.env` file at the project root via the `springboot3-dotenv` dependency.

### 13.3 Camunda Performance Tuning

Cluster REST **traffic is primarily driven by `app.polling.interval-ms`** (each SSE session schedules `getResponse` on that interval, which performs variable search). **`idle-interval-multiplier` does not reduce API calls** — it only reduces how often **`processing`** events are **sent over SSE** after many empty polls.

**Default Strategy (Recommended):**
- **Base polling:** 1000ms → up to **one** variables search per second per active SSE session (if each poll completes before the next tick).
- **SSE throttling:** After >10 empty polls while `processing`, some ticks skip **`emitter.send`** (modulo idle multiplier), not `getResponse`.
- **Example load:** 10 concurrent sessions ≈ up to **10** variable-search calls/sec (before accounting for slow polls skipping the next tick via `tryStartPoll`).

**Tuning Guidelines:**

| Scenario | Recommended Settings | Notes |
|----------|---------------------|-------|
| **Development/Testing** | `interval-ms: 1000, idle-multiplier: 2.0` | Default |
| **Low traffic (<5 sessions)** | Keep default | Overhead usually negligible |
| **High traffic (50+ sessions)** | Increase **`interval-ms`** (e.g. 2000–3000) | Halves or thirds per-session API rate; increases worst-case latency to the new interval |
| **Very high traffic (100+)** | `interval-ms: 3000` or higher | Trade latency for fewer Cluster REST calls |
| **Latency-sensitive** | `interval-ms: 800` | Slightly higher API rate |

**Trade-offs:**
- **Shorter `interval-ms`:** Lower latency to detect `ready`, more Cluster REST requests per session.
- **Longer `interval-ms`:** Fewer requests, higher maximum wait for the next poll.
- **Higher idle multiplier:** Fewer duplicate `processing` SSE lines in the browser during long-running work; **no** impact on Camunda API quota by itself.

**Monitoring:**
- Track Cluster REST request rate: should stay within Camunda quota limits.
- Monitor response latency in browser DevTools relative to `interval-ms`.
- Check Camunda audit logs for API rate patterns.

### 13.4 Frontend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE` | `http://localhost:8081/api/chat` | Backend API base URL |

Set in `.env` or `.env.local` at the `Frontend/` directory root for non-default environments.

### 13.5 Tech Stack Versions

| Component | Technology | Version |
|-----------|------------|---------|
| Backend runtime | Java | 21 |
| Backend framework | Spring Boot | 3.4.3 |
| Camunda SDK | camunda-spring-boot-starter | 8.8.0 |
| HTTP client | Spring RestClient / JDK HttpClient | (from Spring Boot BOM) |
| Build tool | Maven | 3.x |
| Frontend framework | React | 18.3.1 |
| Build tool | Vite | 4.5.5 |
| Markdown rendering | react-markdown + remark-gfm | 10.1.0 + 4.0.1 |
| Testing (backend) | JUnit 5 + Mockito + MockMvc | (from Spring Boot BOM) |
| Testing (frontend) | Vitest + Testing Library | 0.34.6 + 14.x |

---

## 14. Testing

### 14.1 Backend Tests

#### `ChatControllerTest` (`@WebMvcTest`)

Tests the HTTP layer in isolation using `MockMvc` with a mocked `CamundaChatService`.

| Test | Validates |
|------|-----------|
| `startChat_withValidBody_returns200` | Valid JSON body → 200, sessionId and processInstanceKey in response |
| `startChat_withBlankInputText_returns400` | Whitespace-only `inputText` → 400 |
| `startChat_withNullBody_returns400` | Missing `inputText` field → 400 |
| `getResponse_returns200WhenServiceReturnsProcessing` | `processing` status propagated correctly |
| `sendReply_withValidBody_returns200` | Valid reply body → 200 |
| `sendReply_withBlankFollowUpInput_returns400` | Whitespace-only `followUpInput` → 400 |

#### `SessionStateTest`

Unit tests for the domain model's state machine logic.

| Test | Validates |
|------|-----------|
| Constructor defaults | `awaitingResponse=true`, `expired=false`, counters at 0 |
| `checkAndAcceptNewResponse` — new response | Returns response text, clears `awaitingResponse` |
| `checkAndAcceptNewResponse` — same response | Returns null (no duplicate delivery) |
| `checkAndAcceptNewResponse` — not awaiting | Returns null |
| `incrementAndResetConsecutiveErrors` | Counter increment and reset to 0 |
| `incrementAndResetEmptyPolls` | Counter increment and reset to 0 |
| `setAwaitingResponseTrue_resetsEmptyPolls` | Setting `awaitingResponse=true` resets empty poll counter |

#### `SessionRepositoryTest`

Unit tests for session storage and cleanup.

| Test | Validates |
|------|-----------|
| `saveAndGetActiveSession_returnsSession` | Round-trip: save then retrieve |
| `getActiveSession_throwsSessionNotFoundForUnknownId` | Unknown ID → `SessionNotFoundException` |
| `getActiveSession_throwsSessionExpiredWhenMarkedExpired` | `isExpired=true` → `SessionExpiredException` |
| `cleanupExpiredSessions_removesOldSessions` | Aged-out sessions removed, fresh sessions retained |

### 14.2 Frontend Tests

#### `ChatInput.test.jsx`

| Test | Validates |
|------|-----------|
| Form submit | `onSend` called with correct text |
| Empty submit | `onSend` not called for empty input |
| Enter key | Submits on Enter, not on Shift+Enter |
| Disabled state | Input not submittable when `disabled=true` |

#### `MessageBubble.test.jsx`

| Test | Validates |
|------|-----------|
| User message | Correct bubble class and text |
| AI markdown | Markdown rendered (e.g. `**bold**` → `<strong>`) |
| System message | Correct styling class |
| `<thinking>` stripping | Tags and content removed from display |
| Link attributes | `target="_blank"` and `rel="noopener noreferrer"` present |

### 14.3 Running Tests

```bash
# Backend
cd Backend
mvn test

# Frontend
cd Frontend
npm test
```

---

## 15. Project Structure

```
AI Agent Chat With Tools/
├── DOCUMENTATION.md                    (this file)
│
├── Backend/
│   ├── pom.xml
│   └── src/
│       ├── main/
│       │   ├── java/com/example/aichat/
│       │   │   ├── CamundaChatApplication.java
│       │   │   ├── camunda/
│       │   │   │   ├── CamundaRestClient.java
│       │   │   │   └── MessagePublisher.java
│       │   │   ├── config/
│       │   │   │   ├── ClusterRestClientConfig.java
│       │   │   │   └── WebConfig.java
│       │   │   ├── controller/
│       │   │   │   └── ChatController.java
│       │   │   ├── dto/
│       │   │   │   ├── ChatResponseDTO.java
│       │   │   │   ├── ErrorResponse.java
│       │   │   │   ├── ReplyRequest.java
│       │   │   │   ├── StartChatRequest.java
│       │   │   │   └── StartChatResponse.java
│       │   │   ├── exception/
│       │   │   │   ├── ApiException.java
│       │   │   │   ├── GlobalExceptionHandler.java
│       │   │   │   ├── ProcessStartException.java
│       │   │   │   ├── SessionExpiredException.java
│       │   │   │   └── SessionNotFoundException.java
│       │   │   ├── model/
│       │   │   │   └── SessionState.java
│       │   │   ├── repository/
│       │   │   │   └── SessionRepository.java
│       │   │   ├── service/
│       │   │   │   ├── CamundaChatService.java
│       │   │   │   └── SseStreamOrchestrator.java
│       │   │   └── worker/
│       │   │       ├── ListUsersWorker.java
│       │   │       ├── GetMenuCategoriesWorker.java
│       │   │       └── GetDishesByCategoryWorker.java
│       │   └── resources/
│       │       ├── application.yaml
│       │       └── bpmn/
│       │           ├── main-chat-router.bpmn
│       │           ├── agent-user-data.bpmn
│       │           ├── agent-catering.bpmn
│       │           ├── agent-structured-response.bpmn
│       │           ├── agent-utility.bpmn
│       │           └── agent-general.bpmn
│       └── test/
│           └── java/com/example/aichat/
│               ├── controller/
│               │   └── ChatControllerTest.java
│               ├── model/
│               │   └── SessionStateTest.java
│               └── repository/
│                   └── SessionRepositoryTest.java
│
└── Frontend/
    ├── package.json
    ├── vite.config.js
    ├── eslint.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── App.css
        ├── index.css
        ├── services/
        │   └── api.js
        ├── components/
        │   ├── ChatWindow.jsx
        │   ├── ChatWindow.css
        │   ├── ChatInput.jsx
        │   ├── ChatInput.css
        │   ├── MessageBubble.jsx
        │   ├── MessageBubble.css
        │   ├── ThinkingIndicator.jsx
        │   ├── ThinkingIndicator.css
        │   ├── ErrorBoundary.jsx
        │   ├── ErrorBoundary.css
        │   ├── SparkIcon.jsx
        │   └── __tests__/
        │       ├── ChatInput.test.jsx
        │       └── MessageBubble.test.jsx
        └── test/
            └── setup.js
```
