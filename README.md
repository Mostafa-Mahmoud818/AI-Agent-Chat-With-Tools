# AI Agent Chat With Tools

A chat application powered by **Camunda 8** and an AI agent that can use tools (jokes API, user lookup, recipe search, date/time, superflux calculation, URL fetch, etc.). The backend publishes Camunda messages to start and continue chat sessions; the React frontend displays agent responses in a continuous conversation loop.

## Overview

- **Backend**: Spring Boot 3 + Camunda 8 (Zeebe SaaS). Publishes messages to start chat sessions (`ai-chat-start`) and correlate follow-up replies (`ai-chat-user-reply`). Polls process instance variables for the AI agent's response.
- **Frontend**: React + Vite chat UI. Sends the initial message, polls for the agent's response, and allows continuous follow-up messages in a chat loop.
- **Process**: BPMN `ai-agent-chat-with-tools` (v2.1) with a message-based chat loop. The AI Agent ad-hoc subprocess contains tools: Jokes API, List Users, Load User by ID, Search Recipe, Get Date and Time, Superflux Product Calculation, and Fetch URL. After each agent response, the process waits for a user reply message or a 30-minute inactivity timeout.

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

- `POST /api/chat/start` — body `{ "inputText": "Tell me a joke" }` → returns `{ "sessionId": "...", "processInstanceKey": "..." }`.
- `GET /api/chat/{sessionId}/response` — returns `{ "status": "processing"|"ready", "responseText": "..." }`.
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
├── ai agent chat with tools.bpmn   # Process definition (v2.1)
├── ai agent chat *.form            # Form definitions (legacy, not used by v2.1)
└── README.md                       # This file
```

## License

Apache-2.0 (see [LICENSE](LICENSE) in the repo).
