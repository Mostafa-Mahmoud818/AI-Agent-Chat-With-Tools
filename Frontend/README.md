# AI Agent Chat With Tools — Frontend

React + Vite frontend for the AI Agent Chat application powered by Camunda 8 orchestration.

## Quick Start

```bash
# 1. Setup environment
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
```

Opens http://localhost:5173 and connects to the backend on `http://localhost:8085/api/v1/public/chatting` (or `/api/v1/secure/chatting` if authenticated).

## Backend Requirements

- **Backend running**: Modulith Service on port 8085
- **PostgreSQL**: Database with dxp-chatting schema
- **Camunda 8 SaaS cluster**: Configured for AI orchestration

## Features

✅ Real-time SSE streaming for agent responses  
✅ Multi-turn conversational AI with message history  
✅ Multi-agent routing (catering vs IT support via Camunda classifier)  
✅ Markdown rendering of agent responses  
✅ Structured menu display (catering agent)  
✅ Responsive React/Vite UI

## Development

### Scripts
```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run preview   # Preview production build
npm test          # Run tests (Vitest)
```

### Project Structure
```
src/
├── components/       # React components
│   ├── ChatLayout.jsx
│   ├── ChatWindow.jsx
│   ├── ConversationSidebar.jsx
│   ├── MessageBubble.jsx
│   └── ...
├── services/         # API client
│   └── api.js
├── utils/            # Utilities
│   ├── agentMessage.js    # Turn/Message + SSE JSON parsing
│   ├── menuSelection.js  # Menu clicks → `Selected … id:` (BPMN classifier bypass)
│   └── logger.js
├── assets/           # Static assets
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_ORIGIN` | `http://localhost:8085` | Modulith Service backend URL (no trailing slash) |
| `VITE_LOG_LEVEL` | `info` | Log verbosity: debug\|info\|warn\|error |
| `VITE_DEFAULT_CATERING_RESOURCE_ID` | _(unset)_ | Optional resource id sent on orchestration start (catering ACL) |

## Technology Stack

- **React** 18.3
- **Vite** 4.5 (build tool)
- **Markdown** react-markdown + remark-gfm for rich text
- **Testing** Vitest + Testing Library
- **Styling** CSS modules (scoped)

## REST API contract

The TypeScript/JSDoc source of truth for request/response shapes is [`src/services/api.js`](src/services/api.js).  
Backend process variables and BPMN alignment: see the Ankabut repo [`docs/bpmn-variables.md`](../../../ANKABUT/Ankabut-DXP-Services/docs/bpmn-variables.md) (example relative URL from this demo app when the backend repo lives at `D:\ANKABUT\Ankabut-DXP-Services`; clone location may differ).

### Main endpoints (modulith service)

Guest mode (anonymous):
```
POST   /api/v1/public/chatting/conversations
POST   /api/v1/public/chatting/orchestration/sessions/{id}/start
POST   /api/v1/public/chatting/orchestration/sessions/{id}/user-messages
GET    /api/v1/public/chatting/orchestration/sessions/{id}/assistant-round/stream
```

Secure mode (JWT authenticated):
```
POST   /api/v1/secure/chatting/conversations
POST   /api/v1/secure/chatting/orchestration/sessions/{id}/start
POST   /api/v1/secure/chatting/orchestration/sessions/{id}/user-messages
GET    /api/v1/secure/chatting/orchestration/sessions/{id}/assistant-round/stream
```

### Authentication

**Guest Mode (Default)**
- Uses `ankabut_guest_id` cookie (auto-generated UUID)
- No login required
- All API requests include `clientId` parameter or cookie

**Secure Mode**
- Uses JWT token from `Authorization: Bearer <token>` header
- Token stored in `localStorage.ankabut_jwt`
- API: `/api/v1/secure/chatting/*`

## Relevant Backend Paths

| Component | Path |
|-----------|------|
| Chatting module | `ankabut-dxp-modulith-service/` |
| Controllers | `src/main/java/**/*.web` |
| DTOs | `ankabut-dxp-commons/src/main/java/com/ankabut/dxp/commons/dto/chatting/` |
| Database schema | `ankabut-dxp-config-service/src/main/resources/db/migration/V19__chatting_setup.sql` |

## Known Limitations

- Pagination defaults (50 conversations, 200 turns) may differ from backend defaults (20)
- Quick prompts are static demos — actual routing determined by backend
- No message editing/deletion (designed by backend as append-only)
- Session resumption requires explicit previous session ID

## Troubleshooting

Common issues:
1. **"Network error"** → Check backend is running on port 8085 or update `VITE_API_ORIGIN`
2. **"Session expired"** → Backend may have timeout configured, check `/orchestration/sessions/` endpoint
3. **SSE not connecting** → Verify JWT token in localStorage (secure mode) or proxy config

## Performance & Monitoring

- **SSE Timeout**: 15 seconds (configurable in `api.js`)
- **Logging**: Use `VITE_LOG_LEVEL=debug` for detailed request/response logs
- **Browser DevTools**: Check Network tab for API calls, Console for structured logs

## Production Deployment

1. Update `VITE_API_ORIGIN` to production backend URL
2. Run `npm run build` → generates `dist/`
3. Serve `dist/` via static file server (Nginx, Apache, etc.)
4. Ensure CORS headers allow frontend origin if on different domain

## Links

- [Ankabut DXP Services (backend)](../../../ANKABUT/Ankabut-DXP-Services) — adjust path if the repo is checked out elsewhere
- [React](https://react.dev)
- [Vite](https://vite.dev)
- [Camunda Platform](https://camunda.com)
