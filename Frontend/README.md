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

Opens http://localhost:5173.

**Default (secure):** calls **`/api/v1/secure/chatting/*`** against `VITE_API_ORIGIN` or the `VITE_API_BACKEND` preset, with **`Authorization: Bearer …`** from `VITE_API_BEARER_TOKEN` (or local OTP when enabled).

**Guest (Ankabut public API):** set **`VITE_CHAT_AUTH=guest`** to use **`/api/v1/public/chatting/*`**. The UI generates a stable UUID `clientId` (localStorage), sets the **`ankabut_guest_id`** cookie (plain UUID when the server has no HMAC secret), and appends **`?clientId=`** on requests so cross-origin works without credentialed cookies. Pair with **`VITE_API_RELATIVE=1`** so `npm run dev` proxies **`/api`** to the modulith (see `vite.config.js`).

## Backend Requirements

- **Backend reachable**: CORS must allow your dev origin when using a full `VITE_API_ORIGIN` (e.g. `http://localhost:8085`)
- **Secure mode**: `VITE_API_BEARER_TOKEN` (or local OTP) required
- **Guest mode**: no JWT; modulith must expose public chatting + orchestration routes
- **PostgreSQL / Camunda**: as configured on that modulith environment

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
| `VITE_API_ORIGIN` | _(see `VITE_API_BACKEND` if unset)_ | Modulith base URL, no trailing slash |
| `VITE_API_RELATIVE` | off | When `1` / `true`, API base URL is empty → same-origin **`/api/...`** (Vite dev proxy) |
| `VITE_API_BACKEND` | `remote-dev` | Preset when origin not set: `local` → `http://localhost:8085`, `remote-dev` → `https://dev-modulith.naitive.ai`, `remote-test` → `https://test-modulith.naitive.ai` |
| `VITE_CHAT_AUTH` | _(unset = secure)_ | Set to **`guest`** for **`/api/v1/public/chatting`** + UUID `clientId` (no bearer) |
| `VITE_GUEST_COOKIE_NAME` | `ankabut_guest_id` | Must match modulith `chatting.guest-cookie-name` if you override it |
| `VITE_API_BEARER_TOKEN` | _(none)_ | Bearer JWT for secure chatting + SSE (not used in guest mode) |
| `VITE_LOG_LEVEL` | `info` in prod / `debug` in dev | Log verbosity: debug\|info\|warn\|error |
| `VITE_DEFAULT_RESOURCE_ID` | _(unset)_ | Optional `resourceId` on orchestration **start** (max 128 chars server-side) |

**Auth:** secure mode — set `VITE_API_BEARER_TOKEN` and restart `npm run dev`. Guest mode — set `VITE_CHAT_AUTH=guest` (and usually `VITE_API_RELATIVE=1` for local docker/modulith). Vite inlines env into the bundle; do not ship production builds with long-lived secrets.

### API alignment (Ankabut modulith)

| Flow | Secure path | Public (guest) path |
|------|-------------|---------------------|
| List / create conversations, turns | `/api/v1/secure/chatting/...` | `/api/v1/public/chatting/...` |
| Start orchestration, user-messages, assistant SSE | `/api/v1/secure/chatting/orchestration/...` | `/api/v1/public/chatting/orchestration/...` |

Create conversation (guest) uses body **`{ clientId, req: { initialTitle, initialSummary } }`** per `CreateConversationWithIdentityRequest`. Orchestration payloads match **`ChattingOrchestrationStartRequest`** / **`ChattingOrchestrationFollowUpRequest`**. SSE events are JSON **`ChattingOrchestrationRoundResponseDto`** (`status`: `ready` \| `processing` \| `error` \| `expired`, `message`, `handledBy`).

## Technology Stack

- **React** 18.3
- **Vite** 4.5 (build tool)
- **Markdown** react-markdown + remark-gfm for rich text
- **Testing** Vitest + Testing Library
- **Styling** CSS modules (scoped)

## REST API contract

The TypeScript/JSDoc source of truth for request/response shapes is [`src/services/api.js`](src/services/api.js).  
Backend process variables and BPMN alignment: see the Ankabut repo [`docs/bpmn-variables.md`](../../../ANKABUT/Ankabut-DXP-Services/docs/bpmn-variables.md) (example relative URL from this demo app when the backend repo lives at `D:\ANKABUT\Ankabut-DXP-Services`; clone location may differ).

### Main endpoints (modulith — secure chatting)

All URLs are resolved as `{VITE_API_ORIGIN}/api/v1/secure/chatting/...`:

```
POST   /api/v1/secure/chatting/conversations
GET    /api/v1/secure/chatting/conversations
GET    /api/v1/secure/chatting/conversations/{conversationId}/turns
POST   /api/v1/secure/chatting/orchestration/conversations/{conversationId}/start
POST   /api/v1/secure/chatting/orchestration/conversations/{conversationId}/user-messages
GET    /api/v1/secure/chatting/orchestration/conversations/{conversationId}/assistant-round/stream
```

### Authentication

- Every request sends `Authorization: Bearer <VITE_API_BEARER_TOKEN>`.
- Server-Sent Events use `fetch` with the same header (no guest `EventSource`).

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
- Session rollover and Camunda `previousSessionId` are handled only by the modulith (`ensureActiveOrchestrationSession`); clients do not send `previousSessionId` on start

## Troubleshooting

Common issues:
1. **Missing token / API errors** → Set `VITE_API_BEARER_TOKEN` in `.env` and restart the dev server  
2. **"Network error" / CORS** → Modulith must allow `http://localhost:5173` (or your dev origin); check `VITE_API_ORIGIN`  
3. **"Session expired"** → Backend timeout; SSE is keyed by **conversation**  
4. **SSE not connecting** → Confirm token and that the stream URL returns 200 with `text/event-stream`

## Performance & Monitoring

- **SSE Timeout**: 15 seconds (configurable in `api.js`)
- **Logging**: Use `VITE_LOG_LEVEL=debug` for detailed request/response logs
- **Browser DevTools**: Check Network tab for API calls, Console for structured logs

## Production Deployment

1. Set `VITE_API_ORIGIN` to the production modulith URL (if not using the default dev host)  
2. Prefer **not** baking a long-lived `VITE_API_BEARER_TOKEN` into public builds; use a BFF or user login that mints short-lived tokens  
3. Run `npm run build` → `dist/` for static hosting

## Links

- [Ankabut DXP Services (backend)](../../../ANKABUT/Ankabut-DXP-Services) — adjust path if the repo is checked out elsewhere
- [React](https://react.dev)
- [Vite](https://vite.dev)
- [Camunda Platform](https://camunda.com)
