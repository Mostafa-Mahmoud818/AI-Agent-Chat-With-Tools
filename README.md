# AI Agent Chat With Tools

A chat application powered by **Camunda 8** with a **multi-agent architecture**. User requests are classified and routed to specialized AI agents (user data, content & entertainment, utility & web, or general knowledge), each owning a distinct set of tools. The backend publishes Camunda messages to start and continue chat sessions; the React frontend displays agent responses in a continuous conversation loop.

## Overview

- **Backend**: Spring Boot 3 + Camunda 8 (Zeebe SaaS). Publishes messages to start chat sessions (`ai-chat-start`) and correlate follow-up replies (`ai-chat-user-reply`). Polls process instance variables for the AI agent's response.
- **Frontend**: React + Vite chat UI. Sends the initial message, polls for the agent's response, and allows continuous follow-up messages in a chat loop.
- **Process**: BPMN `ai-agent-chat-with-tools` (v3.0) with a message-based chat loop and multi-agent routing. A keyword-based classifier routes each request to one of four specialized AI Agent subprocesses. After each agent response, the process waits for a user reply message or a 30-minute inactivity timeout.

## Multi-Agent Architecture

The process uses an **AI Classifier Gateway** pattern:

1. **Classify Request** -- A FEEL script task analyzes the user input via keyword matching
2. **Route by Category** -- An exclusive gateway routes to the appropriate agent
3. **Specialized Agents** -- Each agent has its own system prompt and tool set
4. **Merge Results** -- A merge gateway collects the output before the chat loop continues

| Agent | Tools | Handles |
|---|---|---|
| **User Data Agent** | List Users, Load User by ID | User lookups, contact details |
| **Utility & Web Agent** | Get Date/Time, Superflux Product, Fetch URL | Date/time, calculations, web fetching |
| **General Agent** | Knowledge Answer (placeholder) | General knowledge questions (fallback); answers from built-in knowledge |

Each agent maintains **isolated conversation context** — its memory is stored in a per-agent variable (e.g., `userDataAgentCtx`), preventing cross-contamination when routing changes between turns. Each agent is independently scalable and extensible. Adding a new agent requires creating a new ad-hoc subprocess with its own context variable, adding a routing branch, and updating the classifier keywords.

## Prerequisites

- **Java 21**
- **Node.js** (LTS, e.g. 18+)
- **Camunda 8** SaaS cluster (with the process and AI agent deployed)
- **Backend config**: `.env` file in the `Backend/` directory (see below)

## Configuration

The backend loads credentials from a `.env` file (via [spring-dotenv](https://github.com/paulschwarz/spring-dotenv)). Copy the example and fill in your values:

```bash
cd Backend
cp .env.example .env
```

Then edit `Backend/.env`:

```dotenv
CAMUNDA_CLIENT_ID=your-client-id
CAMUNDA_CLIENT_SECRET=your-client-secret
CAMUNDA_CLIENT_CLOUD_CLUSTERID=your-cluster-id
CAMUNDA_CLIENT_CLOUD_REGION=your-region
```

Find your credentials at **https://console.camunda.io** -> your cluster -> **API** tab -> **Client Credentials**.

| Variable | Where to find it |
|---|---|
| `CAMUNDA_CLIENT_ID` | Camunda Console -> cluster -> API -> Client Credentials |
| `CAMUNDA_CLIENT_SECRET` | Camunda Console -> cluster -> API -> Client Credentials |
| `CAMUNDA_CLIENT_CLOUD_CLUSTERID` | Camunda Console -> cluster overview -> Cluster ID |
| `CAMUNDA_CLIENT_CLOUD_REGION` | Camunda Console -> cluster overview -> Region (e.g. `ric-1`) |

The `.env` file is gitignored. Real environment variables always take precedence over `.env` values.

## Running the application

### Backend

```bash
cd Backend
./mvnw spring-boot:run
```

Runs by default on **http://localhost:8081**. Endpoints:

- `POST /api/chat/start` — body `{ "inputText": "What is the capital of France?" }` → returns `{ "sessionId": "...", "processInstanceKey": "..." }`.
- `GET /api/chat/{sessionId}/response` — returns `{ "status": "processing"|"ready", "responseText": "...", "handledBy": "..." }`. The `handledBy` field indicates which specialized agent handled the request (e.g., "User Data Agent").
- `POST /api/chat/{sessionId}/reply` — body `{ "followUpInput": "Follow up question..." }` → sends a follow-up message to the agent.

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
│   ├── .env.example         # Environment variable template (copy to .env)
│   ├── src/main/java/       # ChatController, ChatService, CamundaRestClient, config, DTOs, model
│   └── src/main/resources/  # application.yaml.template, config
├── Frontend/                # React + Vite
│   ├── src/
│   │   ├── components/      # ChatWindow, ChatInput, MessageBubble, ThinkingIndicator
│   │   └── services/        # api.js (startChat, getResponse, sendReply)
│   └── package.json
├── ai agent chat with tools.bpmn   # Process definition (v3.0, multi-agent)
├── ai agent chat *.form            # Form definitions (legacy, not used by v3.0)
└── README.md                       # This file
```

## License

Apache-2.0 (see [LICENSE](LICENSE) in the repo).
