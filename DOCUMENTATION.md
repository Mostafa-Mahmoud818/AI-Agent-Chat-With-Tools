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

---

## 1. System Overview

AI Agent Chat With Tools is a three-tier web application that enables multi-turn conversational AI sessions orchestrated entirely by **Camunda 8 SaaS**. A **React/Vite** frontend presents the chat interface to the user. A **Spring Boot** backend translates chat interactions into Zeebe messages that start and drive BPMN processes on Camunda Cloud. Those processes classify each request, route it to one of four AI agent subprocesses (User Data, Content & Entertainment, Utility & Web, General), and invoke external REST APIs or FEEL scripts to gather results. The backend delivers responses back to the browser in real time via **Server-Sent Events (SSE)**, eliminating polling latency. Each conversation is a single long-running BPMN process instance that loops until a 30-minute inactivity timer expires.

---

## 2. Architecture Diagram

```mermaid
graph TD
    subgraph browser [Browser]
        FE["React/Vite App\nport 5173"]
    end

    subgraph backend [Spring Boot Backend\nport 8081]
        CTRL["ChatController\n/api/chat/**"]
        SVC["CamundaChatService"]
        PUB["MessagePublisher\nZeebe gRPC"]
        RC["CamundaRestClient\nCluster REST API v2"]
        SR["SessionRepository\nin-memory"]
        WC["ClusterWebClientConfig\nOAuth2 token cache"]
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
    end

    FE -->|"POST /start, POST /reply\nHTTP"| CTRL
    FE -->|"GET /stream\nSSE / EventSource"| CTRL
    FE -->|"GET /response (fallback)\nHTTP"| CTRL

    CTRL --> SVC
    SVC --> PUB
    SVC --> RC
    SVC --> SR

    PUB -->|"correlate() / publish()\ngRPC TLS"| ZEEBE
    RC -->|"POST /v2/variables/search\nPOST /v2/process-instances/search\nGET /v2/variables/{key}"| CAPI
    WC -->|"client_credentials\nOAuth2"| CAPI

    ZEEBE --> AI
    ZEEBE -->|"HTTP Connector"| JP
    ZEEBE -->|"HTTP Connector"| DJ
    ZEEBE -->|"HTTP Connector"| FETCH
```

### Communication Protocols Summary

| Link | Protocol | Detail |
|------|----------|--------|
| Frontend → Backend (HTTP) | HTTP/1.1 over TCP | REST JSON, port 8081 |
| Frontend → Backend (SSE) | HTTP/1.1, `text/event-stream` | `EventSource` persistent connection |
| Backend → Zeebe | gRPC over TLS | Port 443, `grpcs://` address |
| Backend → Cluster REST API | HTTPS | Bearer token (OAuth2), WebFlux `WebClient` |
| Backend → Auth Server | HTTPS | `client_credentials` grant, form-encoded |
| Camunda → External APIs | HTTPS | HTTP JSON Connector (`io.camunda:http-json:1`) |

---

## 3. BPMN Process Design

### 3.1 Two Process Architectures

The repository contains two distinct BPMN implementations of the same business logic. Both share the same message names and variable contracts.

#### Architecture A — Monolithic (`ai-agent-chat-with-tools.bpmn`)

All four AI agent subprocesses are embedded as **Ad-Hoc SubProcesses** directly inside the single main process. Suitable for self-contained deployment where everything deploys as one unit.

- **Process ID:** `ai-agent-chat-with-tools`
- **Version Tag:** 3.2

#### Architecture B — Modular (`Backend/src/main/resources/bpmn/`)

The main router delegates to four separate deployed processes via **Call Activities**. Each agent is an independent process definition that can be versioned, deployed, and tested in isolation. BPMN files are under `Backend/src/main/resources/bpmn/`: `main-chat-router.bpmn`, `agent-user-data.bpmn`, `agent-content.bpmn`, `agent-utility.bpmn`, and `agent-general.bpmn`. Processes can be deployed to the cluster via Camunda Web Modeler, CI/CD, or Zeebe classpath deployment.

- **Router Process ID:** `ai-agent-chat-router`
- **Version Tag:** 2.1
- **Child processes:** `ai-agent-user-data`, `ai-agent-content`, `ai-agent-utility`, `ai-agent-general`

### 3.2 Main Process Flow

```mermaid
flowchart TD
    Start(["Message Start Event\nai-chat-start"])
    GwStartCont{"Start or\nContinue?"}
    Classify["AI Agent Task\nClassify Request Intent\nrouteCategory = LLM"]
    GwRoute{"Route by\ncategory"}
    UserData["Agent Subprocess\nUser Data"]
    Content["Agent Subprocess\nContent & Entertainment"]
    Utility["Agent Subprocess\nUtility & Web"]
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
    GwRoute -->|"content"| Content
    GwRoute -->|"utility"| Utility
    GwRoute -->|"general"| General
    UserData --> GwMerge
    Content --> GwMerge
    Utility --> GwMerge
    General --> GwMerge
    UserData --- ErrBoundary
    Content --- ErrBoundary
    Utility --- ErrBoundary
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
| AI Agent Task (Service Task) | Classify Request Intent | `ClassifyRequestIntent` | AI-powered intent classification via LLM; returns `routeCategory` directly in `response.responseText` (no tools) |
| Call Activity | User Data Agent | `Call_UserData` | Calls `ai-agent-user-data` process to handle user data queries |
| Call Activity | Utility & Web Agent | `Call_Utility` | Calls `ai-agent-utility` process for date/time, math, URL fetch |
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
| `ai-agent-chat-router` | 2.1 | Main orchestration process; routes requests to specialized agents |
| `ai-agent-user-data` | 1.0 | User data lookups (list users, load user by ID) |
| `ai-agent-content` | 1.0 | Content & entertainment (recipes, jokes) |
| `ai-agent-utility` | 1.0 | Utility operations (date/time, math, URL fetch) |
| `ai-agent-general` | 1.0 | General knowledge and conversational queries |


### 3.4 AI Agent Architecture

All specialized agent processes (`ai-agent-*`) use the **AI Agent Job Worker** connector (`io.camunda.agenticai:aiagent-job-worker:1`) from Camunda, configured with:

- **Provider:** AWS Bedrock (Claude 3.5 Haiku)
- **Memory:** In-process storage with 20-entry context window
- **Tool Call Behavior:** `WAIT_FOR_TOOL_CALL_RESULTS` — agent can make multiple tool calls and receives results
- **Response Formatting:** Markdown text with optional JSON parsing
- **Context Retention:** Each agent maintains its own context variable for conversation awareness across turns

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

#### Content & Entertainment Agent (`ai-agent-content`)

| Task | Connector | Endpoint | Method | Purpose |
|------|-----------|----------|--------|---------|

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
| `routeCategory` | Internal | ClassifyRequestIntent | Routing gateway | `user_data`, `content`, `utility`, or `general` — AI classifier result |
| `classifierAgentCtx` | Internal | ClassifyRequestIntent | ClassifyRequestIntent (next turn) | Classifier's internal memory for context-aware classification across turns |
| `conversationHistory` | Internal | StoreConversationHistory script | All agents | List of last 6 conversation entries (3 exchanges); format: `["User: ... | agent: ..."]` |
| `userDataAgentCtx` | Internal | User Data Agent subprocess | User Data Agent (next turn) | User Data Agent's context memory |
| `contentAgentCtx` | Internal | Content Agent subprocess | Content Agent (next turn) | Content Agent's context memory |
| `utilityAgentCtx` | Internal | Utility Agent subprocess | Utility Agent (next turn) | Utility Agent's context memory |
| `generalAgentCtx` | Internal | General Agent subprocess | General Agent (next turn) | General Agent's context memory |
| `agent` | Output | Agent subprocess | Backend | `{responseText, context}` — final response text and agent state |
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

Each agent also maintains its own context variable (`userDataAgentCtx`, `contentAgentCtx`, etc.) for internal state that persists across turns of the same category.

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
    service["service\nChatService\nCamundaChatService"]
    camunda["camunda\nCamundaRestClient\nMessagePublisher\nClusterWebClientConfig"]
    repository["repository\nSessionRepository"]
    model["model\nSessionState"]
    dto["dto\n5 records"]
    exception["exception\nGlobalExceptionHandler\n3 custom exceptions"]
    config["config\nWebConfig\nMdcFilter\nStartupConfigLogger"]
    worker["worker\nListUsersWorker"]

    controller --> service
    controller --> dto
    controller --> exception
    service --> camunda
    service --> repository
    service --> model
    service --> dto
    service --> exception
    camunda --> config
    repository --> model
    repository --> exception
```

### 4.2 Package Responsibilities

| Package | Classes | Responsibility |
|---------|---------|----------------|
| `com.example.aichat` | `CamundaChatApplication` | Spring Boot entry point; enables scheduling |
| `com.example.aichat.controller` | `ChatController` | HTTP entry points; input validation; delegates to `ChatService` |
| `com.example.aichat.service` | `ChatService`, `CamundaChatService`, `AgentResponseMapper`, `ResponseResolutionHandler`, `SseStreamOrchestrator` | Business logic; session lifecycle; variable→response mapping; resolution strategies; SSE stream lifecycle |
| `com.example.aichat.camunda` | `ProcessVariableClient`, `ZeebeMessageGateway`, `CamundaRestClient`, `MessagePublisher`, `ClusterWebClientConfig` | Abstractions for variables/state and messages; REST API v2; Zeebe publish/correlate; OAuth2 WebClient |
| `com.example.aichat.worker` | `JokesApiWorker`, `ListUsersWorker` | Zeebe job workers for AI Agent tools (list users); return `toolCallResult` |
| `com.example.aichat.repository` | `SessionStore`, `SessionRepository` | Session storage abstraction; in-memory implementation with scheduled expiry cleanup |
| `com.example.aichat.model` | `SessionState` | Mutable, thread-safe chat session state |
| `com.example.aichat.dto` | 5 records | Immutable request/response contracts |
| `com.example.aichat.exception` | `GlobalExceptionHandler`, 3 custom exceptions | Centralized exception-to-HTTP mapping |
| `com.example.aichat.config` | `WebConfig`, `MdcFilter`, `StartupConfigLogger` | CORS, MDC, request logging |

---

## 5. Backend Component Details

### 5.1 ChatController

`@Validated @RestController @RequestMapping("/api/chat")`

| Method | Path | Request Body | Response Body | Success | Notes |
|--------|------|--------------|---------------|---------|-------|
| POST | `/start` | `StartChatRequest` | `StartChatResponse` | 200 | Starts new session; correlates start message |
| GET | `/{sessionId}/response` | — | `ChatResponseDTO` | 200 | Fallback polling endpoint |
| POST | `/{sessionId}/reply` | `ReplyRequest` | — | 200 | Publishes follow-up message |
| GET | `/{sessionId}/stream` | — | SSE stream of `ChatResponseDTO` events | 200 | Primary response channel |

All `{sessionId}` path variables are validated with `@NotBlank`. Request bodies are validated with `@Valid`.

### 5.2 ChatService Interface

```
ChatService
├── startSession(inputText) → SessionState
├── getResponse(sessionId) → ChatResponseDTO
├── sendReply(sessionId, followUpInput) → void
└── streamResponse(sessionId) → SseEmitter
```

Follows the **Dependency Inversion Principle** — `ChatController` depends on the interface, not the concrete implementation.

### 5.3 CamundaChatService

`@Service` implementing `ChatService`. Orchestrates session lifecycle and response resolution; depends on abstractions and delegates SSE to `SseStreamOrchestrator` (SOLID: DIP, SRP).

**Dependencies (abstractions):** `ProcessVariableClient`, `ZeebeMessageGateway`, `SessionStore`, `AgentResponseMapper`, `ResponseResolutionHandler`, `SseStreamOrchestrator`.

#### `startSession(String inputText)`

1. Generates a random UUID as `sessionId`.
2. Builds variables map: `sessionId`, `inputText`, `inputDocuments` (empty list).
3. Calls `messageGateway.correlate(startMessageName, "", variables)` — synchronous gRPC call that returns `processInstanceKey`.
4. Constructs and persists a new `SessionState` via `sessionStore.save(session)`.
5. Returns the `SessionState` (sessionId + processInstanceKey exposed to frontend).

#### `getResponse(String sessionId)`

Reads current process state and translates it to a `ChatResponseDTO`:

1. Retrieves `SessionState` from `sessionStore.getActiveSession(sessionId)`.
2. Calls `processVariableClient.fetchProcessInstanceVariables(processInstanceKey)`.
3. If variables are **empty**: delegates to `resolutionHandler.handleEmptyVariables(session)` (empty poll counter, terminal-state check, expiry).
4. If variables are **present**: uses `responseMapper.toResponseData(variables)` for route category, response text, label, and agent hash; calls `session.checkAndAcceptNewResponse(...)` to atomically detect a new response.
5. If stale-poll threshold reached: delegates to `resolutionHandler.handleStaleResponse(...)` (flow-node/terminal check).
6. Otherwise: returns `resolutionHandler.lastKnownOrProcessing(session)`.
7. On 3+ consecutive errors: returns status `"error"`.

#### `sendReply(String sessionId, String followUpInput)`

1. Validates session via `sessionStore.getActiveSession(sessionId)`.
2. Calls `messageGateway.publish(replyMessageName, sessionId, variables)` — `sessionId` is the correlation key.
3. Sets `session.awaitingResponse = true`.
4. On publish failure: uses `processVariableClient.isProcessInstanceInState(...)` for terminal check; throws `SessionExpiredException` if terminal, otherwise re-throws.

#### `streamResponse(String sessionId)`

Delegates to `sseStreamOrchestrator.streamResponse(sessionId)`, which creates the `SseEmitter`, schedules the poll loop (calling `getResponse()` at fixed intervals), and handles completion/cleanup.

### 5.3.1 SOLID design (backend)

| Principle | Application |
|-----------|-------------|
| **Single Responsibility (SRP)** | `AgentResponseMapper`: variable→response data only. `ResponseResolutionHandler`: empty/stale/last-known resolution. `SseStreamOrchestrator`: SSE lifecycle and polling. `CamundaChatService`: orchestration only. |
| **Open/Closed (OCP)** | New resolution strategies or storage backends can be added without changing existing orchestration. |
| **Dependency Inversion (DIP)** | `ProcessVariableClient` (impl: `CamundaRestClient`), `ZeebeMessageGateway` (impl: `MessagePublisher`), `SessionStore` (impl: `SessionRepository`). Controller and service depend on interfaces. |
| **Interface Segregation** | Narrow interfaces: `ProcessVariableClient` (variables + state checks), `ZeebeMessageGateway` (publish/correlate), `SessionStore` (save/getActiveSession). |

### 5.4 ZeebeMessageGateway and MessagePublisher

`ZeebeMessageGateway` is the interface; `MessagePublisher` is the `@Component` implementation in package `com.example.aichat.camunda` — single point for all Zeebe message operations.

| Method | Zeebe Command | Correlation Key | TTL | Returns | Used For |
|--------|---------------|-----------------|-----|---------|----------|
| `publish()` | `newPublishMessageCommand()` | `sessionId` | 30s | void | Follow-up replies to intermediate catch events |
| `correlate()` | `newCorrelateMessageCommand()` | `""` (empty) | — | `long processInstanceKey` | Start message — synchronous, strongly consistent |

**`publish()` vs `correlate()`:** `publish()` buffers the message in Zeebe for the TTL duration if no subscription exists yet. `correlate()` requires an active subscription and fails immediately if none exists — this is correct for start events since the process is guaranteed to have a waiting message start event when deployed. `correlate()` returns the `processInstanceKey` synchronously, eliminating the need for subsequent polling to find the started instance.

### 5.5 ProcessVariableClient and CamundaRestClient

`ProcessVariableClient` is the interface used by the service layer; `CamundaRestClient` is the `@Component` implementation in package `com.example.aichat.camunda` — all Camunda Cluster REST API v2 HTTP calls.

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

All requests use a 10-second block timeout via Reactor's `Mono.block()`.

### 5.6 ClusterWebClientConfig

`@Configuration` in package `com.example.aichat.camunda` — produces the `clusterWebClient` Spring bean.

- Builds a `WebClient` with `clusterApiUrl` as base URL and a Netty `HttpClient` with:
  - Response timeout: 10 seconds
  - Connection timeout: 5 seconds
- Attaches an `ExchangeFilterFunction` that injects a Bearer token before every request.

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

Token caching is synchronized on the `ClusterWebClientConfig` instance. The 60-second buffer ensures the token is refreshed before it actually expires.

### 5.7 SessionStore and SessionRepository

`SessionStore` is the interface (save, getActiveSession); `SessionRepository` is the `@Repository` implementation — in-memory `ConcurrentHashMap<String, SessionState>`.

| Operation | Method | Behavior |
|-----------|--------|----------|
| Store session | `save(SessionState)` | Puts by `sessionId` key |
| Retrieve active | `getActiveSession(String)` | Returns session; throws `SessionNotFoundException` if absent; throws `SessionExpiredException` if `session.isExpired()` |
| Cleanup | `cleanupExpiredSessions()` | `@Scheduled` every 5 minutes; removes entries where `isExpired() == true` OR `createdAt` is before the max-age cutoff |

Sessions are never evicted mid-stream; they age out naturally 30 minutes after creation or are explicitly marked expired by `CamundaChatService`.

### 5.8 Zeebe Job Workers (AI Agent Tools)

The backend registers Zeebe job workers that implement AI Agent tool tasks. When a BPMN agent subprocess invokes a tool (e.g. "List users" or "Jokes API"), Zeebe creates a job that these workers complete and return a `toolCallResult` for the AI Agent connector.

| Worker | Job Type | Purpose |
|--------|----------|---------|
| `ListUsersWorker` | `list-users-worker` | Returns a static list of users (id, name, username, email) as `toolCallResult` for the User Data Agent |
| `JokesApiWorker` | `jokes-api-worker` | Returns a static joke string as `toolCallResult` for the Content & Entertainment Agent |

Both workers use `@JobWorker(type = "...", autoComplete = true, fetchAllVariables = false)` and return `Map.of("toolCallResult", ...)`. They are registered automatically by the Camunda Spring Boot starter.

### 5.9 SessionState

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
| `consecutiveStalePollsWhileAwaiting` | int | 0 | Polls where agent data unchanged while awaiting; triggers gateway check |
| `consecutiveErrors` | int | 0 | Reset on success; triggers error response at 3 |
| `expired` | boolean | false | Set on process termination |

#### `checkAndAcceptNewResponse(currentResponseText, handledBy, agentHash)` — Atomic Detection

This synchronized method prevents duplicate response delivery:

1. Returns `null` if `currentResponseText` is blank.
2. Returns `null` if `awaitingResponse == false` (response already delivered for this turn).
3. Returns `currentResponseText` only if it differs from `lastResponseText` or `agentHash` differs from `lastAgentHash` (new response detected).
4. On detection: updates `lastResponseText`, `lastHandledBy`, `lastAgentHash`, sets `awaitingResponse = false`, resets `consecutiveEmptyPolls` and `consecutiveStalePollsWhileAwaiting`.

### 5.10 GlobalExceptionHandler

`@RestControllerAdvice` — maps all exceptions to structured JSON error responses.

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
| `WebClientResponseException` | 502 Bad Gateway | `upstream_error` |
| `RuntimeException` | 500 Internal Server Error | `internal_error` |
| `Exception` | 500 Internal Server Error | `internal_error` |

All responses use `ErrorResponse(String error, String message)`. The handler logs **WARN** for 4xx (session not found, expired, validation) and **ERROR** for 5xx and process start failures.

### 5.11 Logging

Backend logging is structured and uses SLF4J. The console pattern includes MDC `requestId` and `sessionId` (set by `MdcFilter`).

| Component | Level | Events |
|-----------|--------|--------|
| **ChatController** | INFO | Chat started (sessionId, processInstanceKey); reply sent (sessionId); WARN when SSE stream rejected (session not found/expired) |
| **CamundaChatService** | INFO | SSE stream opened (sessionId); published reply (message name, sessionId); stream error (WARN); persistent/transient response errors (WARN/ERROR); stale-polls gateway check |
| **SessionRepository** | INFO | Cleanup (removed count, remaining) |
| **GlobalExceptionHandler** | WARN | Session not found, session expired, validation errors; ERROR for process start, upstream, runtime |
| **ClusterWebClientConfig** | INFO | OAuth token fetch and expiry |
| **CamundaRestClient** | ERROR/WARN | Process instance search failure; variable fetch failure; full-value fetch failure |

Set `logging.level.com.example.aichat: DEBUG` for more detail (e.g. per-poll or variable fetch).

### 5.12 MdcFilter

`@Component @Order(HIGHEST_PRECEDENCE)` extending `OncePerRequestFilter`.

**Note:** This filter is **required** for proper request logging correlation. The application's logging pattern includes MDC values:

```
%d{HH:mm:ss.SSS} [%thread] %-5level [%X{requestId:-}] [%X{sessionId:-}] %logger{36} - %msg%n
```

For every HTTP request, MdcFilter:
1. Generates a random 8-character `requestId` and puts it in MDC (used for tracking individual requests).
2. Extracts `sessionId` from path `/api/chat/{sessionId}` (if segment is not `"start"`) and puts it in MDC (used for tracking chat sessions).
3. Sets security response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`.
4. Clears MDC in `finally` block after the filter chain completes.

MDC values (`requestId` and `sessionId`) appear in all log lines within the request thread, enabling easy log correlation and troubleshooting. Removing this filter will break the logging pattern.

### 5.13 DTOs

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

The backend implements **smart adaptive polling** for Camunda compatibility. The polling strategy reduces API load by automatically backing off during idle periods (when no new data is available).

```mermaid
sequenceDiagram
    participant FE as "EventSource\n(Browser)"
    participant CTRL as "ChatController"
    participant SVC as "CamundaChatService"
    participant SCHED as "ScheduledExecutorService"
    participant CA as "Cluster REST API"

    FE->>CTRL: GET /{sessionId}/stream\nAccept: text/event-stream
    CTRL->>SVC: streamResponse(sessionId)
    SVC->>SVC: Validate session
    SVC->>SVC: new SseEmitter(600_000ms)
    SVC->>SCHED: scheduleAtFixedRate(poll, 0, pollingIntervalMs, MILLISECONDS)
    Note over SCHED: Default: 1000ms (1 API call/sec)<br/>Adaptive backoff during idle (2x multiplier)
    SVC-->>CTRL: SseEmitter
    CTRL-->>FE: HTTP 200\nContent-Type: text/event-stream\n(connection held open)

    loop Every 1000ms (or configured interval)
        SCHED->>SVC: poll tick
        
        alt Session idle (>10 empty polls) AND idle-multiplier=2.0
            SVC->>SVC: Skip poll (modulo adaptive throttling)
            Note over SVC: Effectively ~2000ms during idle
        else Active polling
            SVC->>CA: POST /v2/variables/search
            CA-->>SVC: variables
            SVC->>SVC: getResponse() → ChatResponseDTO
            
            alt status = "processing"
                SVC->>FE: data: {"status":"processing"}\n\n
            else status = "ready"
                SVC->>FE: data: {"status":"ready","responseText":"...","handledBy":"..."}\n\n
                SVC->>SVC: emitter.complete()
                SVC->>SCHED: future.cancel()
            else status = "error"
                SVC->>FE: data: {"status":"error","responseText":"..."}\n\n
                SVC->>SVC: emitter.complete()
            else SessionExpiredException
                SVC->>FE: data: {"status":"expired"}\n\n
                SVC->>SVC: emitter.complete()
            else IOException (client disconnected)
                SVC->>SVC: emitter.completeWithError()
            end
        end
    end

    Note over FE: 10-min timeout → emitter.onTimeout() → future.cancel()
```

**Polling Strategy for Camunda Compatibility:**
- **Base interval:** 1000ms (1 API call/second per active session)
- **Adaptive backoff:** During idle periods (>10 empty polls), polls are skipped modulo the idle multiplier
- **Idle multiplier:** Default 2.0x - reduces to ~0.5 API calls/second during inactive processing
- **Benefit:** Significantly reduced API pressure on Camunda while maintaining <1s response latency for active queries

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
    participant WC as "ClusterWebClientConfig"
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

Set by `MdcFilter` on every response:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking via iframes |
| `Cache-Control` | `no-store` | Prevents sensitive API responses from being cached |

### 9.4 Request Tracing with MDC

`MdcFilter` injects two values into SLF4J MDC before each request:

- **`requestId`**: A random 8-character UUID prefix — unique per HTTP request.
- **`sessionId`**: Extracted from the URL path `/api/chat/{sessionId}` when applicable.

These appear in every log line for the duration of that request thread:

```
14:23:01.456 [http-nio-8081-exec-3] INFO  [a1b2c3d4] [sess-uuid-here] c.e.a.s.CamundaChatService - Correlated ai-chat-start ...
```

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
| `getResponse(sessionId)` | async function | GET `/{sessionId}/response` (fallback) |
| `sendReply(sessionId, followUpInput)` | async function | POST `/{sessionId}/reply` |
| `createResponseStream(sessionId)` | function | Returns `new EventSource(...)` for SSE |
| `ApiError` | class | Custom error: `status`, `errorCode`, `message` |

All HTTP functions use `fetchWithTimeout()` with a 15-second `AbortController` timeout. Network errors and timeouts are normalized into `ApiError` instances.

---

## 11. REST API Reference

### Base URL

```
http://localhost:8081/api/chat
```

Configurable via `VITE_API_BASE` environment variable on the frontend.

---

### POST `/api/chat/start`

Starts a new chat session. Correlates the `ai-chat-start` Zeebe message, which triggers the BPMN Message Start Event and returns the process instance key synchronously.

**Request**

```json
{ "inputText": "What is the capital of France?" }
```

| Field | Type | Constraints |
|-------|------|-------------|
| `inputText` | string | Required, not blank, max 4000 chars |

**Response — 200 OK**

```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000", "processInstanceKey": "2251799813685324" }
```

**Error Responses**

| Status | Error Code | Cause |
|--------|------------|-------|
| 400 | `validation_error` | Blank or missing `inputText` |
| 503 | `process_start_failed` | Zeebe correlation failed (process not deployed, network error) |

---

### GET `/api/chat/{sessionId}/response`

Fallback polling endpoint. Returns current process state as a single snapshot.

**Response — 200 OK**

```json
{ "status": "processing", "responseText": null, "handledBy": null }
```

```json
{ "status": "ready", "responseText": "Why did the scarecrow win an award?...", "handledBy": "Content & Entertainment Agent" }
```

**Error Responses**

| Status | Error Code | Cause |
|--------|------------|-------|
| 400 | `validation_error` | Blank `sessionId` |
| 404 | `session_not_found` | Unknown session ID |
| 410 | `session_expired` | Process completed or timed out |

---

### POST `/api/chat/{sessionId}/reply`

Sends a follow-up message to an active session. Publishes the `ai-chat-user-reply` message to Zeebe, correlated by `sessionId`.

**Request**

```json
{ "followUpInput": "Can you tell me another one?" }
```

| Field | Type | Constraints |
|-------|------|-------------|
| `followUpInput` | string | Required, not blank, max 4000 chars |

**Response — 200 OK** — empty body.

**Error Responses**

| Status | Error Code | Cause |
|--------|------------|-------|
| 400 | `validation_error` | Blank or missing `followUpInput` |
| 404 | `session_not_found` | Unknown session ID |
| 410 | `session_expired` | Process already completed |
| 500 | `internal_error` | Zeebe publish failed |

---

### GET `/api/chat/{sessionId}/stream`

Primary response channel. Opens a Server-Sent Events stream. The backend polls Camunda every ~1 second and pushes a `ChatResponseDTO` JSON payload as each SSE data event. The stream closes automatically when a terminal status is emitted.

**Response** — `Content-Type: text/event-stream`

```
data: {"status":"processing","responseText":null,"handledBy":null}

data: {"status":"ready","responseText":"Here are all users: ...","handledBy":"User Data Agent"}

```

**Terminal statuses** (stream closes after sending): `ready`, `error`, `expired`.

### 11.5 Frontend–Backend–BPMN Alignment

The following table ensures compatibility between the React frontend, Spring Boot API, and deployed BPMNs.

| Layer | Contract | Value / Shape |
|-------|----------|----------------|
| **BPMN messages** | Start message name | `ai-chat-start` (main-chat-router.bpmn `Message_ChatStart`) |
| | Reply message name | `ai-chat-user-reply` (main-chat-router.bpmn `Message_UserReply`) |
| | Reply correlation key | `sessionId` (variable on process) |
| | User-reply catch event id | `MessageCatchEvent_UserReply` (for flow-node check) |
| **Backend config** | `app.camunda.messages.start` | `ai-chat-start` |
| | `app.camunda.messages.reply` | `ai-chat-user-reply` |
| | `app.camunda.reply-catch-event-id` | `MessageCatchEvent_UserReply` (optional; default in code) |
| **Start payload** | Variables sent with start | `sessionId`, `inputText`, `inputDocuments` (list) |
| **Reply payload** | Variables sent with reply | `followUpInput`, `followUpDocuments` (list); correlation key = `sessionId` |
| **Process variables read by backend** | For response resolution | `agent` (object with `responseText`), `routeCategory` (string) |
| **Frontend → API** | POST /start body | `{ "inputText": string }` |
| | POST /{sessionId}/reply body | `{ "followUpInput": string }` |
| | Start response | `{ "sessionId": string, "processInstanceKey": string }` — frontend uses `sessionId` only |
| **SSE / ChatResponseDTO** | Fields | `status`, `responseText`, `handledBy` (all strings; nullable) |
| | Status values | `processing` \| `ready` \| `error` \| `expired` |
| **Error response (4xx/5xx)** | Body | `{ "error": string, "message": string }` — frontend uses `error` as `errorCode`, e.g. `session_expired`, `session_not_found` |
| **Route categories** | Backend agent labels | `user_data` → "User Data Agent", `content` → "Content & Entertainment Agent", `utility` → "Utility & Web Agent", `general` → "General Agent" |

Keep message names and variable names in sync when changing BPMNs or backend; update `application.yaml` and this table if you rename messages or the reply catch event.

**Error Responses** (before stream opens)

| Status | Error Code | Cause |
|--------|------------|-------|
| 404 | `session_not_found` | Unknown session ID |
| 410 | `session_expired` | Session already expired |

---

### Error Response Schema

All error responses share the same structure:

```json
{ "error": "error_code", "message": "Human-readable description" }
```

---

## 12. Error Handling

### 12.1 Backend Exception Mapping

| Exception | Thrown By | HTTP | Error Code | Logged |
|-----------|-----------|------|------------|--------|
| `SessionNotFoundException` | `SessionRepository.getActiveSession()` | 404 | `session_not_found` | No |
| `SessionExpiredException` | `SessionRepository`, `CamundaChatService` | 410 | `session_expired` | No |
| `ProcessStartException` | `CamundaChatService.startSession()` | 503 | `process_start_failed` | ERROR |
| `MethodArgumentNotValidException` | Spring validation | 400 | `validation_error` | No |
| `ConstraintViolationException` | Spring validation | 400 | `validation_error` | No |
| `IllegalArgumentException` | — | 400 | `invalid_request` | No |
| `HttpMessageNotReadableException` | Jackson | 400 | `invalid_request` | No |
| `MethodArgumentTypeMismatchException` | Spring MVC | 400 | `invalid_request` | No |
| `WebClientResponseException` | `CamundaRestClient` | 502 | `upstream_error` | ERROR |
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
| `camunda.client.auth.client-id` | `${CAMUNDA_CLIENT_ID}` | Zeebe client ID |
| `camunda.client.auth.client-secret` | `${CAMUNDA_CLIENT_SECRET}` | Zeebe client secret |
| `camunda.client.auth.token-url` | `https://login.cloud.camunda.io/oauth/token` | OAuth2 token endpoint |
| `camunda.client.grpc-address` | `grpcs://{clusterId}.{region}.zeebe.camunda.io:443` | Zeebe gRPC address |
| `camunda.client.rest-address` | `https://{region}.zeebe.camunda.io/{clusterId}` | Zeebe REST address |
| `camunda.client.cloud.cluster-id` | `${CAMUNDA_CLIENT_CLOUD_CLUSTERID}` | Cluster ID |
| `camunda.client.cloud.region` | `${CAMUNDA_CLIENT_CLOUD_REGION}` | Cluster region |
| `server.port` | `8081` | HTTP server port |
| `app.cors.allowed-origins` | `http://localhost:5173,http://127.0.0.1:5173` | CORS-allowed frontend origins |
| `app.camunda.cluster-api-url` | `https://{region}.zeebe.camunda.io/{clusterId}` | Base URL for Cluster REST API |
| `app.camunda.messages.start` | `ai-chat-start` | Zeebe message name for process start |
| `app.camunda.messages.reply` | `ai-chat-user-reply` | Zeebe message name for user replies |
| `app.camunda.messages.ttl-seconds` | `30` | TTL for published messages (seconds) |
| `app.polling.interval-ms` | `1000` | Base SSE polling interval in milliseconds (1 second = 1 API call/sec per session; optimized for Camunda) |
| `app.polling.idle-interval-multiplier` | `2.0` | Adaptive backoff multiplier during idle periods (>10 empty polls); ~50% API reduction during processing |
| `app.polling.empty-polls-before-expiry-check` | `60` | Consecutive empty variable polls before checking if process is terminal (60s at 1000ms interval) |
| `app.polling.stale-polls-before-gateway-check` | `30` | Stale polls before checking if process reached event-based gateway (30s at 1000ms interval) |
| `app.session.max-age-minutes` | `30` | Session max age before cleanup |
| `app.session.cleanup-interval-ms` | `300000` | Session cleanup interval (5 minutes) |
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

This application is optimized for Camunda SaaS by reducing unnecessary API calls while maintaining low response latency.

**Default Strategy (Recommended):**
- **Base polling:** 1000ms (1 second) = 1 API call/second per active SSE session
- **Idle backoff:** 2.0x multiplier skips polls during idle (>10 empty polls), reducing to ~0.5 API calls/second
- **Example load:** 10 concurrent sessions = ~10 API calls/sec (active) or ~5 API calls/sec (idle processing)

**Tuning Guidelines:**

| Scenario | Recommended Settings | Notes |
|----------|---------------------|-------|
| **Development/Testing** | `interval-ms: 1000, idle-multiplier: 2.0` | Default; good balance |
| **Low traffic (<5 sessions)** | Keep default | Polling overhead negligible |
| **High traffic (50+ sessions)** | `interval-ms: 2000, idle-multiplier: 3.0` | 2s base = 0.5 API/sec per session; 6s idle = 0.17 API/sec |
| **Very high traffic (100+)** | `interval-ms: 3000, idle-multiplier: 4.0` | 3s base; ~1.4 API calls/sec total across 100 sessions |
| **Latency-sensitive** | `interval-ms: 800, idle-multiplier: 1.5` | Faster responses; slight increase in API load |

**Trade-offs:**
- **Shorter intervals (500-800ms):** Faster response times (1s max latency) but higher API pressure
- **Longer intervals (2000-3000ms):** Reduced API calls but slower response times (up to 3s)
- **Higher idle multiplier:** More aggressive throttling during idle, less responsive to long-running processes

**Monitoring:**
- Track API request rate: should not exceed Camunda quota limits
- Monitor response latency in browser DevTools; typical <1s for active queries with default settings
- Check Camunda audit logs for API rate patterns

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
| Reactive HTTP | Spring WebFlux / Reactor Netty | (from Spring Boot BOM) |
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

Tests the HTTP layer in isolation using `MockMvc` with a mocked `ChatService`.

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
│       │   │   │   ├── ClusterWebClientConfig.java
│       │   │   │   ├── MessagePublisher.java
│       │   │   │   ├── ProcessVariableClient.java (interface)
│       │   │   │   └── ZeebeMessageGateway.java (interface)
│       │   │   ├── config/
│       │   │   │   ├── MdcFilter.java
│       │   │   │   ├── StartupConfigLogger.java
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
│       │   │   │   ├── GlobalExceptionHandler.java
│       │   │   │   ├── ProcessStartException.java
│       │   │   │   ├── SessionExpiredException.java
│       │   │   │   └── SessionNotFoundException.java
│       │   │   ├── model/
│       │   │   │   └── SessionState.java
│       │   │   ├── repository/
│       │   │   │   ├── SessionRepository.java
│       │   │   │   └── SessionStore.java (interface)
│       │   │   ├── service/
│       │   │   │   ├── AgentResponseMapper.java
│       │   │   │   ├── CamundaChatService.java
│       │   │   │   ├── ChatService.java (interface)
│       │   │   │   ├── ResponseResolutionHandler.java
│       │   │   │   └── SseStreamOrchestrator.java
│       │   │   └── worker/
│       │   │       ├── JokesApiWorker.java
│       │   │       └── ListUsersWorker.java
│       │   └── resources/
│       │       ├── application.yaml
│       │       ├── application.yaml.template
│       │       └── bpmn/
│       │           ├── main-chat-router.bpmn
│       │           ├── agent-user-data.bpmn
│       │           ├── agent-content.bpmn
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
