# AI Agent Chat With Tools

A chat application powered by **Camunda 8** with a **multi-agent architecture**. User requests are classified and routed to specialized AI agents (user data, content & entertainment, utility & web, or general knowledge), each owning a distinct set of tools. The backend publishes Camunda messages to start and continue chat sessions; the React frontend displays agent responses in a continuous conversation loop.

## Overview

- **Frontend**: React + Vite (port 5173) with dual-mode auth (guest cookie or JWT secure). Manages conversations, sessions, and multi-turn messaging.
- **Backend**: Modulith Service (port 8085) with PostgreSQL and Camunda 8 SaaS integration. Provides REST APIs for conversation/session management and AI orchestration.
- **Process**: BPMN processes with multi-agent AI routing. A classifier routes requests to specialized agents (User Data, Utility & Web, Catering, General). After each agent response, the process waits for user reply or 30-minute timeout.

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

- **Node.js** (LTS, e.g. 18+)
- **Modulith Service** running on port 8085 with:
  - PostgreSQL database (dxp-chatting schema auto-initialized)
  - Camunda 8 SaaS cluster configured with AI agents deployed

## Configuration

### Frontend

The frontend connects to the Modulith Service backend (default: `http://localhost:8085`).

To customize the backend URL, copy the `.env` example:

```bash
cd Frontend
cp .env.example .env
```

Then edit `Frontend/.env`:

```env
# Backend API origin (Modulith Service); default: http://localhost:8085
VITE_API_ORIGIN=http://localhost:8085

# Log level (optional): debug | info | warn | error
# VITE_LOG_LEVEL=debug
```

### Backend (Modulith Service)

Ensure the Modulith Service is configured with:
- PostgreSQL database (dxp-chatting schema)
- Camunda 8 SaaS cluster credentials (for Zeebe orchestration)
- CORS origins to include frontend port (e.g., `http://localhost:5173`)

## Running the application

### Backend (Modulith Service)

Ensure Modulith Service is running on **http://localhost:8085** before starting the frontend.

See Modulith Service deployment docs for setup and configuration.

### Frontend

```bash
cd Frontend
npm install
npm run dev
```

Opens **http://localhost:5173**. The app automatically connects to the Modulith Service backend.

**Dual-mode authentication:**
- **Guest**: Auto-generated UUID stored in `ankabut_guest_id` cookie
- **Secure**: JWT token via `Authorization` header (if available in localStorage)

## Project structure

```
├── DOCUMENTATION.md                    # Detailed technical reference
├── Frontend/                           # React + Vite dual-auth chat UI
│   ├── src/
│   │   ├── components/                 # ChatWindow, ChatInput, MessageBubble, etc.
│   │   ├── services/api.js             # Modulith Service REST client (guest + JWT)
│   │   └── utils/                      # Logging, message parsing
│   ├── .env.example                    # Frontend config template
│   └── package.json
├── docs/                               # Feature-specific documentation
│   └── catering-service.md
└── README.md                           # This file
```
├── ai agent chat with tools.bpmn   # Process definition (v3.0, multi-agent)
├── ai agent chat *.form            # Form definitions (legacy, not used by v3.0)
└── README.md                       # This file
```

## License

Apache-2.0 (see [LICENSE](LICENSE) in the repo).
