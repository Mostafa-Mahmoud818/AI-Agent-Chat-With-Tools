# AI Agent Chat — Backend

Spring Boot backend for the AI Agent Chat application. Exposes a REST API and SSE stream, and integrates with Camunda 8 SaaS for process orchestration.

## Requirements

- Java 21
- Maven 3.9+
- Camunda 8 SaaS cluster (client credentials)
- Environment variables or `.env`: see [Configuration](#configuration)

## Build and run

```bash
mvn spring-boot:run
```

Server runs on port **8081**. API base: `http://localhost:8081/api/chat`.

## Project structure (industry-aligned)

```
src/main/java/com/example/aichat/
├── CamundaChatApplication.java     # Entry point, @EnableScheduling, @EnableConfigurationProperties
├── config/                         # Spring configuration (API, CORS, security headers, WebClient, scheduling)
│   ├── AppApiProperties.java      # app.api (base-path)
│   ├── AppCorsProperties.java      # app.cors (origins, methods, headers, credentials)
│   ├── AppSecurityHeadersProperties.java  # app.security-headers
│   ├── ClusterWebClientConfig.java # Camunda Cluster REST API WebClient + OAuth
│   ├── SchedulingConfig.java      # Executor for SSE polling
│   └── WebConfig.java             # CORS, security headers filter
├── controller/                     # REST API layer
│   └── ChatController.java
├── dto/
│   ├── request/                    # Inbound API request bodies
│   │   ├── ReplyRequest.java
│   │   └── StartChatRequest.java
│   └── response/                  # Outbound API / SSE payloads
│       ├── ChatResponseDTO.java
│       ├── ErrorResponse.java
│       └── StartChatResponse.java
├── exception/                      # Domain exceptions and global handler
│   ├── ApiException.java          # Base for API errors (errorCode + HttpStatus)
│   ├── GlobalExceptionHandler.java
│   ├── ProcessStartException.java
│   ├── SessionExpiredException.java
│   └── SessionNotFoundException.java
├── model/                          # Domain model (non-persisted)
│   └── SessionState.java
├── repository/                     # Session storage abstraction
│   └── SessionRepository.java
├── service/                        # Business logic
│   ├── CamundaChatService.java
│   └── SseStreamOrchestrator.java
├── camunda/                        # Camunda 8 integration (Zeebe + Cluster API)
│   ├── CamundaRestClient.java     # Cluster REST API v2 (variables, flow nodes)
│   └── MessagePublisher.java      # Zeebe message correlate/publish
└── worker/                         # Zeebe job workers (AI agent tools)
    ├── JokesApiWorker.java
    └── ListUsersWorker.java
```

### Conventions

- **API base path**: Set in `app.api.base-path`; controller and CORS use it so they stay in sync.
- **DTOs**: Request bodies in `dto.request`, response/SSE bodies in `dto.response`.
- **Exceptions**: Domain API errors extend `ApiException` (error code + HTTP status); `GlobalExceptionHandler` maps them to `ErrorResponse` JSON.
- **Config**: Static properties live in `application.yaml`; type-safe binding via `@ConfigurationProperties` (e.g. `AppCorsProperties`, `AppApiProperties`, `AppSecurityHeadersProperties`).

## Configuration

Key settings in `application.yaml` (and env):

| Area | Key | Description |
|------|-----|-------------|
| Server | `server.port` | HTTP port (default 8081) |
| API | `app.api.base-path` | REST API base path (default /api/chat) |
| CORS | `app.cors.allowed-origins` | Comma-separated frontend origins |
| CORS | `app.cors.allowed-methods` | Allowed HTTP methods (default GET,POST,OPTIONS) |
| CORS | `app.cors.allowed-headers` | Allowed request headers |
| CORS | `app.cors.allow-credentials` | Whether to allow credentials (default false) |
| Security headers | `app.security-headers.*` | X-Content-Type-Options, X-Frame-Options, Cache-Control |
| SSE | `app.sse.emitter-timeout-ms` | SSE emitter timeout in ms (default 600000) |
| Camunda | `app.camunda.messages.start` / `reply` | Zeebe message names for start and user reply |
| Camunda | `app.camunda.reply-catch-event-id` | BPMN catch event id for reply (flow-node check) |
| Camunda | `app.camunda.cluster-api-url` | Cluster REST API base URL |
| Zeebe | `camunda.client.auth.*` | OAuth2 client credentials for Zeebe |

Required environment variables (or `.env`): `CAMUNDA_CLIENT_ID`, `CAMUNDA_CLIENT_SECRET`, `CAMUNDA_CLIENT_CLOUD_CLUSTERID`, `CAMUNDA_CLIENT_CLOUD_REGION`.

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat/start` | Start a new chat (body: `inputText`) |
| GET | `/api/chat/{sessionId}/response` | Poll current response (fallback) |
| GET | `/api/chat/{sessionId}/stream` | SSE stream of response updates |
| POST | `/api/chat/{sessionId}/reply` | Send follow-up (body: `followUpInput`) |

See root `DOCUMENTATION.md` for full request/response shapes and frontend–backend–BPMN alignment.

## Tests

```bash
mvn test
```
