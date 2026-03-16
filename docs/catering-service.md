# Catering Service — Technical Documentation

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture & Request Flow](#2-architecture--request-flow)
3. [BPMN Processes](#3-bpmn-processes)
   - [Main Chat Router](#31-main-chat-router)
   - [Catering Agent](#32-catering-agent)
4. [Backend](#4-backend)
   - [REST API Endpoints](#41-rest-api-endpoints)
   - [Service Layer](#42-service-layer)
   - [Zeebe Job Workers](#43-zeebe-job-workers)
   - [Static Menu Data](#44-static-menu-data)
   - [Camunda Integration](#45-camunda-integration)
   - [Configuration](#46-configuration)
5. [Frontend](#5-frontend)
   - [API Service](#51-api-service)
   - [ChatWindow](#52-chatwindow)
   - [MessageBubble & MenuItems](#53-messagebubble--menuitems)
   - [Styling](#54-styling)
6. [Response Format Contract](#6-response-format-contract)
7. [Data Flow — Step by Step](#7-data-flow--step-by-step)
8. [Environment Variables](#8-environment-variables)

---

## 1. Overview

The **Catering Service** is a domain-specific AI agent embedded within the broader AI Chat application. It enables users to browse a restaurant's menu through a conversational interface. The agent responds to food-related queries by invoking backend tools that return structured menu data, which the frontend then renders as interactive menu cards.

### What it does

- Classifies incoming chat messages as catering-related
- Delegates the conversation to a dedicated **Catering AI Agent** backed by AWS Bedrock (Claude 3.5 Haiku)
- The agent calls tools to fetch menu categories and dishes
- Returns structured JSON that the frontend renders as clickable menu item cards
- Supports multi-turn conversation — clicking a menu card sends its label as a follow-up message

### Technology Stack

| Layer | Technology |
|---|---|
| Orchestration | Camunda 8 (SaaS), Zeebe |
| AI Model | AWS Bedrock — Claude 3.5 Haiku |
| Backend | Java 21, Spring Boot 3.4.3 |
| Frontend | React 18, Vite 4, SSE |
| API | REST + Server-Sent Events |

---

## 2. Architecture & Request Flow

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                           │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐   │
│  │  ChatWindow  │───▶│  POST /api/chat/start        │   │
│  │  (React)     │    │  GET  /api/chat/{id}/stream  │   │
│  │              │◀───│  POST /api/chat/{id}/reply   │   │
│  └──────┬───────┘    └──────────────────────────────┘   │
│         │ renders                                        │
│  ┌──────▼───────────────────────┐                       │
│  │ MessageBubble + MenuItems    │                       │
│  │ (menu cards, price display)  │                       │
│  └──────────────────────────────┘                       │
└──────────────────────────────────────────┬──────────────┘
                                           │ HTTP / SSE
┌──────────────────────────────────────────▼──────────────┐
│                      BACKEND                            │
│                                                         │
│  ChatController ──▶ CamundaChatService                  │
│       │                    │                            │
│       │              MessagePublisher ──▶ Zeebe gRPC    │
│       │              CamundaRestClient ──▶ REST API     │
│       │                                                 │
│  SSE Emitter ◀──── polling loop (1 req/sec)             │
└──────────────────────────────────────────┬──────────────┘
                                           │ Zeebe gRPC / REST
┌──────────────────────────────────────────▼──────────────┐
│                    CAMUNDA 8 (SaaS)                     │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │          main-chat-router.bpmn                   │   │
│  │  Start ──▶ Classify ──▶ Gateway ──▶ Catering?   │   │
│  └──────────────────────────────┬───────────────────┘   │
│                                 │ Call Activity          │
│  ┌──────────────────────────────▼───────────────────┐   │
│  │          agent-catering.bpmn                     │   │
│  │  Ad-Hoc Subprocess                               │   │
│  │  ┌─────────────────┐  ┌────────────────────────┐ │   │
│  │  │ AI Agent Task   │  │ get-menu-categories     │ │   │
│  │  │ (AWS Bedrock)   │─▶│ get-dishes-by-category  │ │   │
│  │  └─────────────────┘  └────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 3. BPMN Processes

### 3.1 Main Chat Router

**File:** `Backend/src/main/resources/bpmn/main-chat-router.bpmn`
**Process ID:** `ai-agent-chat-router`
**Version Tag:** 2.3

#### Process Flow

```
[Start Event]
     │
     ▼
[Set Provider Config]          ← Configures AWS Bedrock, Claude 3.5 Haiku
     │
     ▼
[ClassifyRequestIntent]        ← AI task: classifies user input into one of 4 routes
     │
     ▼
[Exclusive Gateway]
  ├── user_data  ──▶ [Call_UserData subprocess]
  ├── utility    ──▶ [Call_Utility subprocess]
  ├── catering   ──▶ [Call_Catering subprocess]  ◀── catering route
  └── general    ──▶ [Call_General subprocess]
     │
     ▼
[Collect Result]               ← Merges agent output into session variables
     │
     ▼
[MessageCatchEvent_UserReply]  ← Waits for user follow-up (TTL: 30s)
     │
     ▼
[End Event]
```

#### Classification Rules

The classifier routes a message to `catering` when the input contains any of these topics:

> food, menu, dishes, catering, meals, restaurants, ordering food, appetizers, beverages, main courses, drinks, snacks, or browsing what is available to eat.

#### Error Handling

A boundary error event (`Error_Catering`) is attached to the `Call_Catering` activity. If the catering subprocess throws an unhandled error, the boundary event catches it and routes to a graceful error response, preventing the entire session from crashing.

---

### 3.2 Catering Agent

**File:** `Backend/src/main/resources/bpmn/agent-catering.bpmn`
**Process ID:** `ai-agent-catering`
**Version Tag:** 1.0

#### Process Flow

```
[Start Event: Start_Catering]
     │
     ▼
[Ad-Hoc Subprocess: Catering_Agent]
  │
  ├── [AI Agent Task]             ← Camunda agentic connector (AWS Bedrock)
  │       │
  │       ├── invokes ──▶ [Get Menu Categories Task]
  │       │                  type: get-menu-categories-worker
  │       │                  output: array of category objects
  │       │
  │       └── invokes ──▶ [Get Dishes by Category Task]
  │                          type: get-dishes-by-category-worker
  │                          input: categoryId (string)
  │                          output: array of dish objects with price
  │
  └── output collected into: toolCallResults
     │
     ▼
[End Event: End_Catering]
```

#### AI Provider Configuration

| Setting | Value |
|---|---|
| Provider | AWS Bedrock |
| Model | Claude 3.5 Haiku |
| Storage | In-process memory |
| Context window | 20 messages |
| Max model calls | 9999 |

#### System Prompt

```
Role: You are a Catering Menu Assistant. Your purpose is to help users browse our
restaurant menu, view categories, and explore dishes within each category using your tools.

CRITICAL — Output format:
You must ALWAYS respond with ONLY a valid JSON object. Never include any text, markdown,
or code fences outside the JSON. Your response must conform to one of these two formats:

Format 1 — Plain text reply (for greetings, clarifications, or when no menu data is needed):
{
  "replyType": "text",
  "textString": "Your message here"
}

Format 2 — Menu data reply (when returning categories or dishes):
{
  "replyType": "json",
  "textString": "A brief description of what is being shown",
  "payload": {
    "subtype": "menu",
    "menuitems": [
      {
        "id": "item_id",
        "label": "Item Name",
        "description": "Item description.",
        "price": 10.00
      }
    ]
  }
}

Important rules for the payload:
- When showing categories, do NOT include a price field in menuitems.
- When showing dishes within a category, ALWAYS include the price field as a number.
- The menuitems array must contain the exact data returned by the tools — do not fabricate items.

Behaviour:
1. When the user asks to see the menu, browse food options, or asks what is available,
   call Get Menu Categories.
2. When the user selects a specific category (by name or ID), call Get Dishes by Category
   with the correct category ID.
3. If the user asks about something unrelated to food or our menu, respond with a text reply
   politely stating you specialise in catering menu assistance.
4. Do NOT use <thinking> tags — write your full answer directly as JSON.
```

#### Tool Definitions

**Tool 1 — Get Menu Categories**

| Property | Value |
|---|---|
| Job type | `get-menu-categories-worker` |
| Input parameters | None |
| Output | `toolCallResult` → array of `{ id, label, description }` |

**Tool 2 — Get Dishes by Category**

| Property | Value |
|---|---|
| Job type | `get-dishes-by-category-worker` |
| Input parameters | `categoryId` (string) |
| Output | `toolCallResult` → array of `{ id, label, description, price }` |

#### Output Collection

The subprocess collects all tool call responses into the process variable `toolCallResults`. Each entry is an object with:
- `id` — job key
- `name` — tool name
- `content` — the tool's response payload

---

## 4. Backend

### 4.1 REST API Endpoints

**Base URL:** `http://localhost:8081/api/chat`
**Controller:** `Backend/src/main/java/com/example/aichat/controller/ChatController.java`

---

#### `POST /api/chat/start`

Starts a new chat session. Publishes an `ai-chat-start` message to Camunda to create a new process instance.

**Request body:**
```json
{
  "inputText": "Show me the catering menu"
}
```

**Response body:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "processInstanceKey": 2251799813685249
}
```

---

#### `GET /api/chat/{sessionId}/stream`

Opens a Server-Sent Events stream that delivers the AI response in real time as Camunda processes complete.

**Response type:** `text/event-stream`
**Timeout:** 10 minutes (configurable via `app.sse.emitter-timeout-ms`)

**SSE event payload:**
```json
{
  "status": "ready",
  "responseText": "{\"replyType\":\"json\",\"textString\":\"...\",\"payload\":{...}}",
  "handledBy": "Catering Agent"
}
```

Possible `status` values:

| Status | Meaning |
|---|---|
| `thinking` | Process is running, no response yet |
| `ready` | Response available |
| `expired` | Session timed out or process ended |
| `error` | Backend error |

---

#### `POST /api/chat/{sessionId}/reply`

Sends a follow-up message to an active session. Publishes an `ai-chat-user-reply` message to the running Camunda process, which resumes at `MessageCatchEvent_UserReply`.

**Request body:**
```json
{
  "followUpInput": "Appetizers"
}
```

**Response:** `200 OK` (no body)

---

### 4.2 Service Layer

**File:** `Backend/src/main/java/com/example/aichat/service/CamundaChatService.java`

#### Session Management

Each chat session is identified by a UUID (`sessionId`) correlated to a Camunda process instance key. Sessions expire after 30 minutes of inactivity.

#### Polling Strategy

The service polls Camunda's REST API for process variables at a configurable interval:

| Setting | Default | Description |
|---|---|---|
| `polling.interval-ms` | 1000 ms | Base interval between polls |
| `polling.idle-interval-multiplier` | 2.0 | Slows polling when idle |
| `polling.empty-polls-before-expiry-check` | 60 | Triggers expiry check after N empty polls |
| `polling.stale-polls-before-gateway-check` | 30 | Checks for gateway state after N stale polls |
| `polling.max-consecutive-errors` | 3 | Marks session as errored after N consecutive API failures |

#### Conversation History

The service maintains the last **6 conversation entries** (3 user/AI exchanges) across all agents. This context is passed to each new agent subprocess, enabling continuity when the user switches topics.

#### Agent Label Mapping

The `routeCategory` variable returned by Camunda is translated to a human-readable label shown in the UI:

| Route Category | Display Label |
|---|---|
| `user_data` | User Data Agent |
| `utility` | Utility & Web Agent |
| `catering` | *(derived from agent process name)* |
| `general` | General Agent |

---

### 4.3 Zeebe Job Workers

#### GetMenuCategoriesWorker

**File:** `Backend/src/main/java/com/example/aichat/worker/GetMenuCategoriesWorker.java`
**Job type:** `get-menu-categories-worker`
**Auto-complete:** yes
**Fetches variables:** no

Returns a static list of the 3 menu categories. No input required.

```java
@JobWorker(type = "get-menu-categories-worker", autoComplete = true, fetchAllVariables = false)
public Map<String, Object> getMenuCategories(final ActivatedJob job) {
    // returns: Map.of("toolCallResult", List<Map<String, Object>>)
}
```

**Output shape:**
```json
{
  "toolCallResult": [
    { "id": "cat_001", "label": "Appetizers",    "description": "Perfect for sharing or a light start." },
    { "id": "cat_002", "label": "Main Courses",  "description": "Our signature selection of hearty entrees." },
    { "id": "cat_003", "label": "Beverages",     "description": "Refreshing sodas, juices, and house blends." }
  ]
}
```

---

#### GetDishesByCategoryWorker

**File:** `Backend/src/main/java/com/example/aichat/worker/GetDishesByCategoryWorker.java`
**Job type:** `get-dishes-by-category-worker`
**Auto-complete:** yes
**Fetches variables:** no (reads `categoryId` via `job.getVariable()`)

Reads `categoryId` from the job variables and looks up the corresponding dishes from a static in-memory map.

**Input variable:**

| Variable | Type | Description |
|---|---|---|
| `categoryId` | String | One of: `cat_001`, `cat_002`, `cat_003` |

**Output shape (on success):**
```json
{
  "toolCallResult": [
    { "id": "item_steak_01", "label": "Ribeye Steak", "description": "300g Grilled steak with garlic butter.", "price": 28.00 }
  ]
}
```

**Output shape (unknown category):**
```json
{
  "toolCallResult": "No dishes found for category 'cat_999'. Valid categories are: cat_001 (Appetizers), cat_002 (Main Courses), cat_003 (Beverages)."
}
```

---

### 4.4 Static Menu Data

All menu data is hardcoded in `GetDishesByCategoryWorker.java` as a static `Map`.

#### cat_001 — Appetizers

| ID | Label | Description | Price |
|---|---|---|---|
| `item_bruschetta_01` | Classic Bruschetta | Toasted bread with tomatoes, basil, and olive oil. | $9.50 |
| `item_wings_01` | Buffalo Wings | Crispy wings tossed in spicy buffalo sauce. | $12.00 |
| `item_soup_01` | French Onion Soup | Rich broth with caramelized onions and melted gruyère. | $10.00 |

#### cat_002 — Main Courses

| ID | Label | Description | Price |
|---|---|---|---|
| `item_steak_01` | Ribeye Steak | 300g Grilled steak with garlic butter. | $28.00 |
| `item_salmon_01` | Pan-Seared Salmon | Served with roasted asparagus and lemon. | $22.50 |
| `item_pasta_01` | Wild Mushroom Risotto | Creamy arborio rice with truffle oil. | $18.00 |

#### cat_003 — Beverages

| ID | Label | Description | Price |
|---|---|---|---|
| `item_lemonade_01` | Fresh Lemonade | House-squeezed with a hint of mint. | $5.00 |
| `item_coffee_01` | Espresso | Double-shot Italian espresso. | $4.50 |
| `item_smoothie_01` | Tropical Smoothie | Mango, pineapple, and coconut blend. | $7.00 |

---

### 4.5 Camunda Integration

#### CamundaRestClient

**File:** `Backend/src/main/java/com/example/aichat/camunda/CamundaRestClient.java`

Wraps the Camunda REST API for read operations:

- **Search process instances** — with filter by process definition key and pagination
- **Fetch process variables** — by name, with automatic truncation handling (fetches full value if variable is truncated)
- **Check process state** — detects `COMPLETED` or `CANCELED` terminal states
- **Check active flow nodes** — detects when process is waiting at a message catch event

#### MessagePublisher

**File:** `Backend/src/main/java/com/example/aichat/camunda/MessagePublisher.java`

Two publishing strategies:

| Method | Use case | Consistency | TTL |
|---|---|---|---|
| `correlate()` | Starting a new session (`ai-chat-start`) | Strong — returns `processInstanceKey` immediately | N/A |
| `publish()` | Sending a user reply (`ai-chat-user-reply`) | Fire-and-forget, buffered | 30 seconds |

---

### 4.6 Configuration

**File:** `Backend/src/main/resources/application.yaml`

```yaml
server:
  port: 8081

app:
  cors:
    allowed-origins: http://localhost:5173,http://127.0.0.1:5173
  sse:
    emitter-timeout-ms: 600000        # 10 minutes
  camunda:
    cluster-api-timeout-seconds: 30
    reply-catch-event-id: MessageCatchEvent_UserReply
    messages:
      start: ai-chat-start
      reply: ai-chat-user-reply
      ttl-seconds: 30
  polling:
    interval-ms: 1000
    idle-interval-multiplier: 2.0
    empty-polls-before-expiry-check: 60
    stale-polls-before-gateway-check: 30
    max-consecutive-errors: 3
  session:
    max-age-minutes: 30
    cleanup-interval-ms: 300000       # 5 minutes
```

---

## 5. Frontend

### 5.1 API Service

**File:** `Frontend/src/services/api.js`
**Base URL:** `http://localhost:8081/api/chat` (override with `VITE_API_BASE` env var)

```js
// Start a new session
startChat(inputText)           // POST /start       → { sessionId, processInstanceKey }

// Send a follow-up in an active session
sendReply(sessionId, text)     // POST /{id}/reply  → 200 OK

// Open an SSE stream for real-time responses
createResponseStream(sessionId) // GET /{id}/stream  → EventSource
```

---

### 5.2 ChatWindow

**File:** `Frontend/src/components/ChatWindow.jsx`

The top-level orchestrator for the chat UI.

#### State

```js
const [messages, setMessages] = useState([])      // full conversation history
const [sessionId, setSessionId]  = useState(null) // active Camunda session
const [phase, setPhase]          = useState('idle')// idle | thinking | ready | expired
const [error, setError]          = useState(null)
const [sending, setSending]      = useState(false)
```

#### SSE Stream Handling

When a message is sent, the frontend opens an `EventSource` to `GET /api/chat/{sessionId}/stream`. Each SSE event is parsed:

```js
const data = JSON.parse(event.data)
// data.status: 'thinking' | 'ready' | 'expired' | 'error'
// data.responseText: raw string (may be JSON or plain text)
// data.handledBy: "Catering Agent"
```

#### Payload Parsing

The raw `responseText` is parsed to extract structured catering data:

```js
let text = data.responseText
let payload = null
try {
    const parsed = JSON.parse(data.responseText)
    if (parsed?.replyType) {
        text = parsed.textString || data.responseText
        if (parsed.replyType === 'json' && parsed.payload) {
            payload = parsed.payload      // ← catering menu payload
        }
    }
} catch {
    // plain text response — use as-is
}
addMessage('ai', text, data.handledBy, payload)
```

#### Quick Prompts

The empty-state UI exposes a "Show me the catering menu" quick-start button alongside other quick prompts:

```js
const QUICK_PROMPTS = [
    'List all users',
    "What's the date and time?",
    'Calculate the superflux product of 5 and 3',
    'Show me the catering menu',
]
```

---

### 5.3 MessageBubble & MenuItems

**File:** `Frontend/src/components/MessageBubble.jsx`

#### MenuItems Component

Renders a vertical grid of interactive menu cards:

```jsx
function MenuItems({ items, onItemClick }) {
    return (
        <div className="menu-items-grid">
            {items.map(item => (
                <button key={item.id} className="menu-card"
                    onClick={() => onItemClick?.(item.label)}>
                    <div className="menu-card-header">
                        <span className="menu-card-label">{item.label}</span>
                        {item.price != null && (
                            <span className="menu-card-price">
                                ${Number(item.price).toFixed(2)}
                            </span>
                        )}
                    </div>
                    {item.description && (
                        <span className="menu-card-desc">{item.description}</span>
                    )}
                </button>
            ))}
        </div>
    )
}
```

Key behaviors:
- **Clickable cards** — clicking any card calls `onItemClick(item.label)`, which triggers `handleSendMessage` in ChatWindow, sending the label as a follow-up message
- **Conditional price** — price is only shown when `item.price != null`, so categories (no price) and dishes (with price) use the same component
- **Currency formatting** — prices are always displayed with exactly 2 decimal places

#### Menu Detection in MessageBubble

```jsx
const hasMenu = isAI
    && message.payload?.subtype === 'menu'
    && message.payload?.menuitems?.length > 0
```

If `hasMenu` is true, the `<MenuItems>` component is rendered below the text content of the AI message.

#### Message Prop Shape

```js
{
  id:        string | number,   // UUID
  role:      'user' | 'ai' | 'system',
  text:      string,            // display text
  handledBy: string | null,     // e.g. "Catering Agent"
  timestamp: Date,
  payload: {
    subtype:   'menu',
    menuitems: [
      {
        id:          string,
        label:       string,
        description: string,   // optional
        price:       number,   // optional — omitted for categories
      }
    ]
  } | null
}
```

---

### 5.4 Styling

**File:** `Frontend/src/components/MessageBubble.css`

```css
.menu-items-grid {
    display: grid;
    grid-template-columns: 1fr;      /* single column — extend with repeat(N, 1fr) */
    gap: 8px;
    margin-top: 10px;
}

.menu-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
}

.menu-card:hover {
    background: rgba(165, 110, 255, 0.1);  /* purple accent on hover */
    border-color: var(--border-accent);
}

.menu-card-label  { font-weight: 600; color: var(--text-primary);   font-size: 13.5px; }
.menu-card-price  { font-weight: 600; color: var(--accent-primary); font-size: 13px; white-space: nowrap; }
.menu-card-desc   { color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
```

---

## 6. Response Format Contract

The Catering Agent always responds with a JSON object conforming to one of two schemas. The backend forwards `responseText` verbatim; the frontend parses it.

### Format 1 — Plain Text Reply

Used for greetings, clarifications, or off-topic deflections.

```json
{
  "replyType": "text",
  "textString": "Hello! I can help you browse our menu. Would you like to see the categories?"
}
```

### Format 2 — Menu Data Reply

Used when returning categories or dishes from a tool call.

```json
{
  "replyType": "json",
  "textString": "Here are our menu categories:",
  "payload": {
    "subtype": "menu",
    "menuitems": [
      {
        "id": "cat_001",
        "label": "Appetizers",
        "description": "Perfect for sharing or a light start."
      }
    ]
  }
}
```

> **Note:** When listing categories, `price` is **omitted**. When listing dishes, `price` is **required** as a number.

### Frontend Parsing Logic

```
responseText
    │
    ├─ try JSON.parse()
    │       │
    │       ├─ has replyType?
    │       │       ├─ "text"  → display textString as plain message
    │       │       └─ "json"  → display textString + render payload as MenuItems
    │       │
    │       └─ no replyType → display raw JSON string
    │
    └─ parse fails → display raw responseText as plain message
```

---

## 7. Data Flow — Step by Step

The following trace follows a user typing **"Show me the catering menu"** through the entire system.

```
 1. User clicks "Show me the catering menu" quick-prompt button
    → ChatWindow.handleSendMessage("Show me the catering menu")

 2. Frontend: POST /api/chat/start  { inputText: "Show me the catering menu" }
    ← Backend returns { sessionId, processInstanceKey }

 3. Frontend opens EventSource: GET /api/chat/{sessionId}/stream
    → ChatWindow sets phase = 'thinking', shows ThinkingIndicator

 4. Backend: MessagePublisher.correlate("ai-chat-start", inputText)
    → Camunda creates process instance of ai-agent-chat-router

 5. Camunda: [Set Provider Config] task executes
    → Sets awsBedrockRegion, modelId = "claude-3-haiku", etc.

 6. Camunda: [ClassifyRequestIntent] AI task executes
    → Model reads "Show me the catering menu" → returns routeCategory = "catering"

 7. Camunda: [Exclusive Gateway] routes to [Call_Catering] activity
    → Starts subprocess instance of ai-agent-catering

 8. Camunda: [Ad-Hoc Subprocess: Catering_Agent] begins
    → AI Agent task (Camunda agentic connector) activates with system prompt

 9. Model decides to call "Get Menu Categories" tool
    → Zeebe publishes job of type: get-menu-categories-worker

10. Backend: GetMenuCategoriesWorker.getMenuCategories() executes
    ← Returns toolCallResult: [cat_001, cat_002, cat_003]

11. Camunda feeds tool result back into the AI Agent task
    → Model generates structured JSON response (Format 2)

12. Subprocess completes, process variable "agent" updated with responseText

13. Backend polling detects new responseText value
    → CamundaChatService emits SSE event:
      { status: "ready", responseText: "{\"replyType\":\"json\",...}", handledBy: "Catering Agent" }

14. Frontend EventSource receives the event
    → JSON.parse(responseText) → extracts textString and payload

15. ChatWindow.addMessage('ai', textString, 'Catering Agent', payload)
    → MessageBubble renders with hasMenu = true
    → MenuItems renders 3 category cards (Appetizers, Main Courses, Beverages)

16. Frontend sets phase = 'ready', closes SSE stream

17. User clicks "Appetizers" card
    → onMenuItemClick("Appetizers") → handleSendMessage("Appetizers")

18. Frontend: POST /api/chat/{sessionId}/reply  { followUpInput: "Appetizers" }
    → Backend: MessagePublisher.publish("ai-chat-user-reply", "Appetizers")
    → Camunda resumes at MessageCatchEvent_UserReply with new input

19. Router re-classifies → "catering" → new Catering Agent subprocess

20. Model calls "Get Dishes by Category" with categoryId = "cat_001"
    → GetDishesByCategoryWorker returns 3 appetizer dishes with prices

21. Model generates response with dishes, frontend renders 3 priced menu cards
```

---

## 8. Environment Variables

### Backend (`.env`)

| Variable | Description |
|---|---|
| `CAMUNDA_CLIENT_ID` | Camunda SaaS OAuth client ID |
| `CAMUNDA_CLIENT_SECRET` | Camunda SaaS OAuth client secret |
| `CAMUNDA_CLIENT_CLOUD_CLUSTERID` | Camunda cluster ID |
| `CAMUNDA_CLIENT_CLOUD_REGION` | Camunda cluster region (e.g. `bru-2`) |

### Frontend (`.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE` | `http://localhost:8081/api/chat` | Backend API base URL |
