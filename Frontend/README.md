# AI Agent Chat With Tools — Frontend

React + Vite frontend for the AI Agent Chat application powered by Camunda 8 orchestration.

## Quick Start

```bash
# 1. Setup environment (optional — most config is now done in the UI)
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
```

Opens http://localhost:5173.

On first load you'll see an **environment picker dialog** (DEV / TEST / STAGE / LOCAL). After picking, sign in with **email + OTP**. Your **visit id** loads automatically from the server (with an optional manual UUID fallback). Everything is persisted to `localStorage`, so subsequent reloads skip the dialog. A **"Change"** link in the badge row re-opens the picker any time.

> Testers no longer need to edit `.env` — pick env + sign in via email OTP in the UI.

### Auth modes

- **Secure (default)** — calls `/api/v1/secure/chatting/*` with `Authorization: Bearer …`. Sign in via **email + OTP** in the auth dialog (DEV, TEST, STAGE, and LOCAL). Optional `VITE_API_BEARER_TOKEN` for CI/automation bootstrap.
- **Guest** — set `VITE_CHAT_AUTH=guest` to use `/api/v1/public/chatting/*`. The UI generates a stable UUID `clientId` (localStorage), sets the `ankabut_guest_id` cookie, and appends `?clientId=` on requests so cross-origin works without credentialed cookies. Pair with `VITE_API_RELATIVE=1` to proxy `/api` through Vite during dev.

## Runtime configuration precedence

`resolveApiOrigin()` ([src/config/apiOrigin.js](src/config/apiOrigin.js)) walks this order and stops at the first match:

1. **UI choice** from the env picker (`localStorage: ankabut.chat.backendEnv`) — set by the dialog, cleared by clicking **Change** + picking a different env.
2. `VITE_API_RELATIVE=1` → empty origin (same-origin `/api`, Vite dev proxy).
3. `VITE_API_ORIGIN` → explicit URL.
4. `VITE_API_BACKEND` → named preset (`local`, `remote-dev`, `remote-test`, `remote-stage`).
5. Default: `remote-dev`.

**Visit ID** (required for orchestration start): URL `?visitId=` → `localStorage: ankabut.chat.visitId` (auth dialog) → `VITE_DEFAULT_VISIT_ID`. The modulith resolves `visitId` to an internal `resourceId` via visitor experience — an unset or all-zero placeholder blocks start in the UI. See [`src/config/chatContext.js`](src/config/chatContext.js).

Bearer-token precedence: the OTP dialog writes to `localStorage: ankabut.chat.accessToken`. On boot, `initTokenStore()` prefers a non-empty `VITE_API_BEARER_TOKEN` (and mirrors it to localStorage); otherwise it loads from localStorage.

## Backend Requirements

- **Backend reachable**: CORS must allow your dev origin (default `http://localhost:5173`) when calling a remote modulith directly. Use `VITE_API_RELATIVE=1` to bypass CORS via Vite's proxy.
- **Secure mode**: sign in via email OTP in the auth dialog (or set `VITE_API_BEARER_TOKEN` for automation).
- **Orchestration start**: visit id auto-loaded after OTP sign-in, or set manually in the dialog, via `?visitId=`, or `VITE_DEFAULT_VISIT_ID` (must exist in visitor experience).
- **Guest mode**: no JWT; modulith must expose `/api/v1/public/chatting/*`.
- **OTP**: all presets use the same email → OTP → JWT UI. DEV/TEST call public endpoints only (`check-eligibility`, `otp/email/token`). LOCAL additionally provisions via `/v1/internal/identity/email/provision` before eligibility; read OTP from `otp_challenges` when email is not configured.

## Features

- Real-time SSE streaming for agent responses
- Multi-turn conversational AI with message history
- Multi-agent routing (Visitor Experience, Catering, IT Support, Facilities & Maintenance via Camunda classifier)
- Markdown rendering of agent responses
- Structured menu display (catering agent)
- In-browser environment switcher (DEV / TEST / STAGE / LOCAL) — no `.env` edits required
- Per-browser token and visit-id overrides for orchestration start
- Responsive React/Vite UI

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
├── App.jsx                       # Root shell
├── authBootstrap.js              # Loads token from env / localStorage on boot
├── auth/
│   ├── tokenStore.js             # Runtime bearer-token store (localStorage)
│   ├── otpAccessTokenFlow.js     # Email + OTP (LOCAL: provision + eligibility; DEV/TEST: public only)
│   ├── secureAuthSession.js      # Shared token + visit resolution for DEV/TEST/LOCAL
│   └── guestClientId.js          # UUID clientId + ankabut_guest_id cookie
├── components/
│   ├── auth/LocalAuthDialog.*    # Env picker + email OTP sign-in / visitId dialog
│   ├── layout/ChatLayout.*       # Sidebar + main pane shell, auth gating, guest visit bar
│   ├── chat/                     # ChatWindow, ChatInput, MessageBubble, ThinkingIndicator
│   ├── sidebar/                  # ConversationSidebar
│   ├── navigation/, ui/, system/ # Misc subcomponents
│   └── __tests__/                # Vitest specs
├── config/
│   ├── apiOrigin.js              # resolveApiOrigin() + getBackendEnvLabel()
│   ├── chatAuth.js               # isGuestChatAuth()
│   ├── chatContext.js            # VISIT chatContext envelope + visitId resolution
│   ├── chattingValidationLimits.js
│   └── runtimeSettings.js        # localStorage-backed backend env override
├── services/api.js               # HTTP + SSE client
└── utils/                        # agentMessage, menuSelection, logger, etc.
```

### Environment Variables

All env vars are optional — the UI can supply backend env, token, and visit id at runtime.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BACKEND` | `remote-dev` | Named preset when the UI picker hasn't been used: `local` → `http://localhost:8085`, `remote-dev` → `https://dev-modulith.naitive.ai`, `remote-test` → `https://test-modulith.naitive.ai`, `remote-stage` → `https://stg-modulith.naitive.ai` |
| `VITE_API_ORIGIN` | _(unset)_ | Explicit modulith base URL (no trailing slash). Wins over `VITE_API_BACKEND`, loses to the UI picker. |
| `VITE_API_RELATIVE` | off | `1` / `true` → same-origin `/api/...` and `/v1/internal/...` via Vite dev proxy (works for DEV, TEST, STAGE, and LOCAL presets; proxy target follows the UI env picker). |
| `VITE_API_BEARER_TOKEN` | _(none)_ | Optional bootstrap bearer. Inlined into the bundle and copied to localStorage on first load. Prefer the in-app dialog for testers. |
| `VITE_DEFAULT_VISIT_ID` | _(unset)_ | **Required** unless set in the auth dialog or `?visitId=`. Visit UUID inside `chatContext` on orchestration start (backend resolves to `resourceId`). |
| `VITE_CHAT_AUTH` | _(unset = secure)_ | Set to `guest` to use `/api/v1/public/chatting/*` (no bearer; UUID clientId). |
| `VITE_GUEST_COOKIE_NAME` | `ankabut_guest_id` | Must match modulith `chatting.guest-cookie-name` if overridden. |
| `VITE_LOCAL_AUTH_EMAIL` | _(unset)_ | Pre-fills the LOCAL OTP email input. |
| `VITE_LOG_LEVEL` | `info` (prod) / `debug` (dev) | `debug` \| `info` \| `warn` \| `error` for the `[ankabut-chat:*]` console logger. |

> Vite inlines `VITE_*` vars into the client bundle at build time — never ship production builds with long-lived production secrets.

### LocalStorage keys

| Key | Set by | Purpose |
|-----|--------|---------|
| `ankabut.chat.backendEnv` | Env picker | `DEV` \| `TEST` \| `STAGE` \| `LOCAL` — overrides `VITE_API_BACKEND` |
| `ankabut.chat.accessToken` | Auth dialog / OTP flow / env bootstrap | Bearer JWT for secure mode |
| `ankabut.chat.visitId` | Auth dialog / `?visitId=` | Overrides `VITE_DEFAULT_VISIT_ID` for orchestration `chatContext` |
| `ankabut.chat.guestClientId` | Guest bootstrap | Stable UUID `clientId` for public API (`guestClientId.js`) |

### API alignment (Ankabut modulith)

| Flow | Secure path | Public (guest) path |
|------|-------------|---------------------|
| List / create conversations, turns | `/api/v1/secure/chatting/...` | `/api/v1/public/chatting/...` |
| Start orchestration, user-messages, assistant SSE | `/api/v1/secure/chatting/orchestration/...` | `/api/v1/public/chatting/orchestration/...` |

Create conversation (guest) uses body `{ clientId, req: { initialTitle, initialSummary } }` per `CreateConversationWithIdentityRequest`. Orchestration start sends `{ inputText, chatContext: { schemaVersion, contextType: "VISIT", contextData: { visitId } }, displayText? }`. Follow-ups send `{ followUpInput, displayText?, clientMessageId? }` only. The client opens SSE **before** POST start/user-messages. SSE events are JSON `ChattingOrchestrationRoundResponseDto` (`status`: `ready` \| `processing` \| `error` \| `expired`, `message`, `handledBy`).

### Environment setup (DEV / TEST / STAGE / LOCAL)

All four presets share the same post-auth pipeline: authenticate → auto-resolve visit from `GET /api/v1/secure/visitor-management/my-visits*` → display active visit id → send `chatContext` on first `/start`. Switching env in the picker clears stored token and visit id.

| Preset | Auth | Visit id |
|--------|------|----------|
| DEV | Email + OTP (public endpoints) | Auto from my-visits (manual fallback in dialog) |
| TEST | Email + OTP (public endpoints) | Auto from my-visits (manual fallback in dialog) |
| STAGE | Email + OTP (public endpoints) | Auto from my-visits (manual fallback in dialog) |
| LOCAL | Email + OTP (provision + public) | Auto from my-visits (manual fallback in dialog) |

## Camunda BPMN alignment

Agent JSON shapes are defined in the Ankabut modulith repo:

- BPMN: `ankabut-dxp-modulith-service/src/main/resources/camunda/bpmns/` (`ai-agent-chat-router`, `ai-agent-catering`, `ai-agent-it_support`, `ai-agent-facilities_maintenance`, `ai-agent-visitor-experience`)
- Prompts: `camunda/prompts/*.md`

The UI parses persisted/SSE agent text in [`src/utils/agentMessage.js`](src/utils/agentMessage.js) (`replyType`, `textContent` / `textString`, `payload.subtype`: `menu`, `ticket`, `order_confirmation`, `error`, `none`). After changing BPMN connectors or prompt contracts:

1. Update fixtures in `src/utils/__tests__/agentMessage.test.js` and component tests if new subtypes appear.
2. Run `npm test`.
3. Manually smoke-test menu navigation, ticket confirmation, and visitor-experience greetings.

Route labels in SSE `handledBy` map via backend `AgentVariableSupport`; persisted turns use `RouteCategory` enums — breadcrumbs handle both in [`src/utils/breadcrumb.js`](src/utils/breadcrumb.js).

## Technology Stack

- **React** 18.3
- **Vite** 4.5
- **Markdown** react-markdown + remark-gfm
- **Testing** Vitest + Testing Library
- **Styling** scoped CSS files per component

## REST API contract

The JSDoc source of truth for request/response shapes is [`src/services/api.js`](src/services/api.js). Backend BPMN/variable docs live in the Ankabut repo at `docs/bpmn-variables.md` (relative path depends on where you cloned the backend; the demo assumes `D:\ANKABUT\Ankabut-DXP-Services`).

### Main endpoints (secure mode)

```
POST   /api/v1/secure/chatting/conversations
GET    /api/v1/secure/chatting/conversations
GET    /api/v1/secure/chatting/conversations/{conversationId}/turns
POST   /api/v1/secure/chatting/orchestration/conversations/{conversationId}/start
POST   /api/v1/secure/chatting/orchestration/conversations/{conversationId}/user-messages
GET    /api/v1/secure/chatting/orchestration/conversations/{conversationId}/assistant-round/stream
```

The guest variants live under `/api/v1/public/chatting/...` with the same shape.

### Authentication

- Secure mode sends `Authorization: Bearer <token>` on every request, including the SSE stream (`fetch`-based — not `EventSource`).
- Guest mode appends `?clientId=<uuid>` and relies on the `ankabut_guest_id` cookie when same-origin.

## Relevant Backend Paths

| Component | Path |
|-----------|------|
| Chatting module | `ankabut-dxp-modulith-service/` |
| Controllers | `src/main/java/**/*.web` |
| DTOs | `ankabut-dxp-commons/src/main/java/com/ankabut/dxp/commons/dto/chatting/` and `dto/chattingorchestration/` |
| Database schema | `ankabut-dxp-config-service/src/main/resources/db/migration/` (`dxp-chatting` schema: V23–V37, V50) |

## Known Limitations

- Sidebar requests 100 conversations per page; `getConversations` defaults to 50 if called without `size`. Turn history defaults to 100 (max 500 per backend). Modulith list default page size may be 20 when `size` is omitted.
- Quick prompts are static demos — actual routing is determined by backend classifier.
- No message editing/deletion (append-only by design).
- Session rollover / Camunda `previousSessionId` handling is owned by the modulith (`ensureActiveOrchestrationSession`); clients do not send `previousSessionId` on start.

## Troubleshooting

1. **The env picker doesn't appear** — you already chose an env in this browser. Click **Change** in the auth dialog's badge row, or clear `ankabut.chat.backendEnv` from localStorage.
2. **"Failed to start conversation. Is the backend running?"** — usually means the API call from `ChatWindow` failed: token missing/expired, CORS blocked, or the modulith is down. Check the Network tab and confirm the **DEV / TEST** badge matches the token's issuing environment.
3. **CORS / network errors against remote-dev or remote-test** — switch to `VITE_API_RELATIVE=1` so requests go through the Vite proxy, or ask backend to whitelist your dev origin.
4. **"Session expired" (HTTP 410)** — modulith timed out the orchestration session; reload and start a new turn.
5. **SSE not connecting** — token must be valid for the selected env and the stream URL should return `200 OK` with `Content-Type: text/event-stream`.
6. **"No account or visit history found for this email"** — the email is not eligible on DEV/TEST (must exist in Identity or have visit records). On LOCAL, run provision first or use an email that already exists.
7. **"Configure a Visit ID before starting a chat"** — set a valid visit UUID in the auth dialog, `?visitId=`, or `VITE_DEFAULT_VISIT_ID`. Orchestration start fails on the backend if the visit cannot be resolved.

## Performance & Monitoring

- **Request timeout**: 15 s (configurable in `src/services/api.js`).
- **Logging**: set `VITE_LOG_LEVEL=debug` for verbose `[ankabut-chat:*]` logs.
- **Browser DevTools**: Network tab for HTTP/SSE, Console for structured logs, Application → Local Storage to inspect the keys listed above.

## Production Deployment

1. Set `VITE_API_ORIGIN` (or `VITE_API_BACKEND`) to the production modulith.
2. Do **not** bake a long-lived `VITE_API_BEARER_TOKEN` into public builds — use a BFF or short-lived tokens minted server-side after user login.
3. `npm run build` → serve `dist/` as static assets.
4. Consider whether the runtime env picker should be hidden in prod (it currently respects whatever a user pastes into localStorage). For locked-down deployments, gate the dialog on `import.meta.env.PROD` if needed.

## Links

- [Ankabut DXP Services (backend)](../../../ANKABUT/Ankabut-DXP-Services) — adjust if your clone lives elsewhere
- [React](https://react.dev)
- [Vite](https://vite.dev)
- [Camunda Platform](https://camunda.com)
