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

On first load you'll see an **environment picker dialog** (DEV / TEST / STAGE / LOCAL). After picking, sign in with **email + OTP**. After sign-in the app resolves **visit** and/or **student** context in parallel:

- Visit → `GET /api/v1/secure/visitor-management/my-visits*` (`visitId`)
- Student persona → OTP `check-eligibility` (`personas` contains `STUDENT` or `reasons` contains `STUDENT_EXISTS`)
- Student chat id → `GET /api/v1/secure/identity/profile/me` (`data.id` = Identity user UUID)

If both succeed, a **Visitor / Student persona picker** appears (last choice is persisted). If only one succeeds, that persona is selected automatically. Everything is persisted to `localStorage`, so subsequent reloads skip the dialog. A **"Change"** link in the badge row re-opens the picker any time.

> Testers no longer need to edit `.env` — pick env + sign in via email OTP in the UI.

### Auth

- **JWT only** — all chat/speech calls use `/api/v1/secure/*` with `Authorization: Bearer …`. Sign in via **email + OTP** in the auth dialog (DEV, TEST, STAGE, and LOCAL). Optional `VITE_API_BEARER_TOKEN` for CI/automation bootstrap.
- **Guest / public chatting was removed** — there is no `VITE_CHAT_AUTH=guest` path and no `/api/v1/public/chatting/*` client.

## Runtime configuration precedence

`resolveApiOrigin()` ([src/config/apiOrigin.js](src/config/apiOrigin.js)) walks this order and stops at the first match:

1. **UI choice** from the env picker (`localStorage: ankabut.chat.backendEnv`) — set by the dialog, cleared by clicking **Change** + picking a different env.
2. `VITE_API_RELATIVE=1` → empty origin (same-origin `/api`, Vite dev proxy).
3. `VITE_API_ORIGIN` → explicit URL.
4. `VITE_API_BACKEND` → named preset (`local`, `remote-dev`, `remote-test`, `remote-stage`).
5. Default: `remote-dev`.

**Chat context for orchestration start** ([`src/config/personaSession.js`](src/config/personaSession.js)):

| Persona | `contextType` | `contextData.id` source |
|---------|---------------|-------------------------|
| Visitor | `VISIT` | `visitId` from my-visits / `?visitId=` / `VITE_DEFAULT_VISIT_ID` |
| Student | `STUDENT` | Identity user UUID from `profile/me` `data.id` (not roster PK / Banner) |

QA overrides: `?persona=STUDENT|VISIT` (active persona), `?studentId=<uuid>` (marks STUDENT eligible; chat id still comes from `profile/me`), `?visitId=`.

Bearer-token precedence: the OTP dialog writes to `localStorage: ankabut.chat.accessToken` (plus refresh + expiry). On boot, `initTokenStore()` prefers a non-empty `VITE_API_BEARER_TOKEN`; otherwise it loads from localStorage.

**Token refresh:** same as before — `POST /api/v1/public/identity/auth/token/refresh`. On failed refresh the app clears tokens **and** visit/student/persona session keys via `clearSecureAuthSession()`.

## Backend Requirements

- **Backend reachable**: CORS must allow your dev origin (default `http://localhost:5173`) when calling a remote modulith directly. Use `VITE_API_RELATIVE=1` to bypass CORS via Vite's proxy.
- **JWT**: sign in via email OTP (or set `VITE_API_BEARER_TOKEN` for automation).
- **At least one persona context**: visit and/or student must resolve after OTP, or New Chat / start is blocked in the UI.
- **OTP**: all presets use email → OTP → JWT. DEV/TEST/STAGE call public identity endpoints; LOCAL additionally provisions via `/v1/internal/identity/email/provision`.

## Features

- Real-time SSE streaming for agent responses (`AssistantTurnReplyDto`)
- Multi-turn conversational AI with message history
- Multi-agent routing (Visitor Experience / Front Door, Catering, IT Support, Facilities & Maintenance, Student Absence, Error Banner)
- Persona picker when both Visitor and Student contexts are available
- Student absence composer modes from the last AI subtype: exclusive end-date (`date_request`) then attach (`attachment_request`) when required, including resume from last turn
- Markdown rendering of agent responses
- Structured menus (catering; single-level absence reasons; Error Banner categories)
- In-browser environment switcher (DEV / TEST / STAGE / LOCAL)
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
│   ├── tokenStore.js             # Runtime access/refresh-token store (localStorage)
│   ├── tokenRefresh.js           # Proactive + 401-triggered access-token refresh
│   ├── otpAccessTokenFlow.js     # Email + OTP
│   ├── secureAuthSession.js      # Token + parallel visit/student resolution
│   ├── visitResolution.js        # my-visits → visitId
│   └── studentResolution.js      # eligible students → profile/me Identity UUID
├── components/
│   ├── auth/LocalAuthDialog.*    # Env picker + email OTP / optional visit UUID
│   ├── layout/ChatLayout.*       # Sidebar + main pane, persona picker, auth gating
│   ├── layout/PersonaPicker.*    # Visitor / Student switcher
│   ├── chat/                     # ChatWindow, ChatInput, MessageBubble, ThinkingIndicator
│   ├── sidebar/                  # ConversationSidebar (Visit/Student badges)
│   └── __tests__/                # Vitest specs
├── config/
│   ├── apiOrigin.js
│   ├── chatContext.js            # VISIT / STUDENT envelopes + id helpers
│   ├── personaSession.js         # Active persona + chatContext for start
│   ├── chattingValidationLimits.js
│   └── runtimeSettings.js
├── services/api.js               # HTTP + SSE client (JWT only)
└── utils/                        # agentMessage, menuSelection, logger, etc.
```

### Environment Variables

All env vars are optional — the UI can supply backend env, token, and visit id at runtime.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BACKEND` | `remote-dev` | Named preset: `local`, `remote-dev`, `remote-test`, `remote-stage` |
| `VITE_API_ORIGIN` | _(unset)_ | Explicit modulith base URL (no trailing slash) |
| `VITE_API_RELATIVE` | off | `1` / `true` → same-origin `/api/...` via Vite proxy |
| `VITE_API_BEARER_TOKEN` | _(none)_ | Optional bootstrap bearer for CI |
| `VITE_DEFAULT_VISIT_ID` | _(unset)_ | Fallback visit UUID for VISIT `chatContext` |
| `VITE_LOCAL_AUTH_EMAIL` / `VITE_AUTH_EMAIL` | _(unset)_ | Pre-fills the OTP email input |
| `VITE_LOG_LEVEL` | `info` (prod) / `debug` (dev) | Console logger level |

### LocalStorage keys

| Key | Purpose |
|-----|---------|
| `ankabut.chat.backendEnv` | `DEV` \| `TEST` \| `STAGE` \| `LOCAL` |
| `ankabut.chat.accessToken` / `refreshToken` / `accessTokenExpiresAt` | JWT session |
| `ankabut.chat.visitId` | Active visit UUID |
| `ankabut.chat.dxpUserId` | Identity user UUID for STUDENT `chatContext.id` |
| `ankabut.chat.studentEligible` | `true` when OTP eligibility matched STUDENT |
| `ankabut.chat.activePersona` | `VISIT` \| `STUDENT` |

### API alignment (Ankabut modulith)

| Flow | Path |
|------|------|
| Conversations / turns | `/api/v1/secure/chatting/...` |
| Start / follow-up / SSE | `/api/v1/secure/chatting/orchestration/...` |
| Speech | `/api/v1/secure/speech/transcriptions` |
| Absence attachment stage | `/api/v1/secure/students/absence-requests/attachments` (201; MIME/size **400**; Banner missing **422**) |
| Identity profile | `/api/v1/secure/identity/profile/me` |

**Start body example (STUDENT):**

```json
{
  "inputText": "I need to submit an absence",
  "chatContext": {
    "schemaVersion": "1.0",
    "contextType": "STUDENT",
    "contextData": { "id": "<identity-user-uuid-from-profile-me>" }
  }
}
```

**Start body example (VISIT):** same shape with `contextType: "VISIT"` and `contextData.id` = visit UUID from my-visits (`visitId` field).

Follow-ups: `{ followUpInput, displayText?, clientMessageId? }`. Open SSE **after** a successful POST start/user-messages (POST-then-stream). Opening the stream before POST can replay a stale previous-round READY. SSE JSON is `AssistantTurnReplyDto` (`status`: `ready` \| `processing` \| `error` \| `expired`, `message`, `handledBy`).

### Banner error release gate (BC-3)

**Decision:** SPA Phase 2 is in this working tree. Ship Flyway V191 (`banner_error` persona grant) in the **same release** as this frontend. Shipping the grant without this SPA still causes wrong-module screenshots and raw menu signals after reload.

### Environment setup (DEV / TEST / STAGE / LOCAL)

| Preset | Auth | Contexts after OTP |
|--------|------|--------------------|
| DEV / TEST / STAGE | Email + OTP (public identity) | Parallel visit + student; picker if both |
| LOCAL | Email + OTP (provision + public) | Same |

Switching env clears token, visit id, student id, and active persona.

## Camunda BPMN alignment

Agent JSON shapes live in the Ankabut modulith:

- BPMN: `ankabut-dxp-modulith-service/src/main/resources/camunda/bpmns/` (router, catering, IT, F&M, visitor-experience, **student-absence**, **banner-error**)
- Prompts: `prompts/chattingorchestration/*.md`

Parsed subtypes in [`src/utils/agentMessage.js`](src/utils/agentMessage.js): `menu`, `ticket`, `order_confirmation`, `error`, `none`, navigation, plus **`attachment_request`** and **`date_request`** (with `dateConstraint`). Absence reason menus use `[student_absence-menu]`; Error Banner category menus use `[banner_error-menu]`. Ticket refs `ABS-*` / `EB-*` use the matching submitted copy.

**Speech-to-text:** mic → `POST /api/v1/secure/speech/transcriptions` → transcript into textarea → Send uses start / user-messages.

## Technology Stack

- **React** 18.3 · **Vite** 4.5 · **Vitest** + Testing Library · scoped CSS

## REST API contract

JSDoc source of truth: [`src/services/api.js`](src/services/api.js).

### Main endpoints

```
POST   /api/v1/secure/chatting/conversations
GET    /api/v1/secure/chatting/conversations
GET    /api/v1/secure/chatting/conversations/{conversationId}/turns
POST   /api/v1/secure/chatting/orchestration/conversations/{conversationId}/start
POST   /api/v1/secure/chatting/orchestration/conversations/{conversationId}/user-messages
GET    /api/v1/secure/chatting/orchestration/conversations/{conversationId}/assistant-round/stream
GET    /api/v1/secure/identity/profile/me
POST   /api/v1/secure/students/absence-requests/attachments
POST   /api/v1/secure/errorbanner/attachments
```

### Authentication

Every secure request (including SSE via `fetch`) sends `Authorization: Bearer <token>`. Sign-in / refresh diagram: [`docs/auth-flow.svg`](docs/auth-flow.svg).

## Known Limitations

- Sidebar requests 100 conversations per page; turn history defaults to 100 (max 500).
- Quick prompts are static demos — routing is determined by the backend classifier.
- No message editing/deletion (append-only).
- Session rollover is owned by the modulith; clients do not send `previousSessionId`.
- Multi-visit picker and EMPLOYEE chat are out of scope.

## Troubleshooting

1. **Env picker missing** — already chosen; click **Change** or clear `ankabut.chat.backendEnv`.
2. **Failed to start** — token/CORS/modulith; or missing visit/student id for the active persona.
3. **CORS** — use `VITE_API_RELATIVE=1`.
4. **Session expired (410)** — start a new turn / New Chat.
5. **No account found for this email** — not eligible on that env.
6. **Configure a Visit/Student ID** — active persona has no resolved id; sign in again, use `?visitId=`, or `?studentId=<uuid>` (eligibility) plus a working `profile/me`.
7. **Other-context conversation read-only** — conversation was started under the other persona; switch persona or New Chat.
8. **Missing Banner** — linked students see a reason menu; unlinked students get a stop message in chat (no menu / no attach). Attachment **422** is only a fallback if staging is reached without a Banner id — show the server message once.
9. **Attachment 400** — MIME/size validation (client also rejects >10 MB / bad types).

## Manual smoke (personas)

See [`docs/TESTING_FLOW.md`](docs/TESTING_FLOW.md) § Student / visitor chat smoke.

## Links

- [Ankabut DXP Services (backend)](../../../ANKABUT/Ankabut-DXP-Services)
- [React](https://react.dev) · [Vite](https://vite.dev) · [Camunda](https://camunda.com)
