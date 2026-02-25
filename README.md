# AI Agent Chat With Tools

A chat application powered by **Camunda 8** and an AI agent that can use tools (jokes API, user lookup, recipe search, email request, etc.). The backend starts BPMN process instances and polls for user tasks; the React frontend displays agent responses and collects feedback or email approval.

## Overview

- **Backend**: Spring Boot 3 + Camunda 8 (Zeebe SaaS). Starts the `ai-agent-chat-with-tools` process, searches for user tasks via the Orchestration Cluster REST API, and completes them.
- **Frontend**: React + Vite chat UI. Sends the initial message, polls for tasks, shows the agent’s reply (e.g. joke or tool result), and offers satisfaction feedback or email approval when required by the process.
- **Process**: BPMN `ai-agent-chat-with-tools` with an AI Agent (tools: Jokes API, List Users, Load User by ID, Search Recipe, Send Email, Fetch URL, etc.), a **User Feedback** user task (with `responseText` from the agent), and an optional **Ask human to send email** user task.

## Prerequisites

- **Java 21**
- **Node.js** (LTS, e.g. 18+)
- **Camunda 8** SaaS cluster (with the process and AI agent deployed)
- **Backend config**: `Backend/src/main/resources/application.yaml` (not in repo; see below)

## Configuration

The backend expects `Backend/src/main/resources/application.yaml`. Copy from a template or create one with at least:

- Camunda client settings: `camunda.client.*` (mode, auth `client-id` / `client-secret`, `token-url`, cloud `cluster-id`, `region`).
- Server port (e.g. `server.port: 8081`).
- `app.cors.allowed-origins` (e.g. `http://localhost:5173,http://127.0.0.1:5173`).
- `app.camunda.process-id`: `ai-agent-chat-with-tools`.
- `app.camunda.cluster-api-url`: your cluster REST base URL (e.g. `https://<region>.zeebe.camunda.io/<cluster-id>`).

Secrets (client secret, API keys) should come from environment variables or a local config file that is not committed.

## Running the application

### Backend

```bash
cd Backend
./mvnw spring-boot:run
```

Runs by default on **http://localhost:8081**. Endpoints:

- `POST /api/chat/start` — body `{ "inputText": "Tell me a joke" }` → returns `{ "processInstanceKey": "..." }`.
- `GET /api/chat/{processInstanceKey}/tasks` — list CREATED user tasks for that instance.
- `POST /api/chat/tasks/{userTaskKey}/complete` — body `{ "variables": { ... } }` to complete a task.

### Frontend

```bash
cd Frontend
npm install
npm run dev
```

Runs by default on **http://localhost:5173** (or http://127.0.0.1:5173). Point the browser there; the app calls the backend at `http://localhost:8081/api/chat`.

## Project structure

```
├── Backend/                 # Spring Boot + Camunda 8
│   ├── src/main/java/      # ChatController, CamundaService, config, DTOs
│   └── src/main/resources/ # application.yaml (create locally, gitignored)
├── Frontend/                # React + Vite
│   ├── src/
│   │   ├── components/      # ChatWindow, ChatInput, FeedbackPanel, etc.
│   │   └── services/        # api.js (startChat, getTasks, completeTask)
│   └── package.json
├── ai agent chat with tools.bpmn   # Process definition
├── ai agent chat *.form            # Form definitions (initial, feedback, email)
└── README.md                       # This file
```

## License

Apache-2.0 (see [LICENSE](LICENSE) in the repo).
