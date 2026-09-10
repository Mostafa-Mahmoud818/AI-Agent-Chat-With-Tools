# Stage Timeout/Resilience Testing — Flow

End-to-end runbook for exercising the shortened stage-only timeout/resilience config
(`V168__common_modulith_stage_fast_timeouts_for_qa.sql`) using the artifacts in this repo:

- `docs/postman/chat-stack-timeout-scenarios.postman_collection.json`
- `docs/k6/chat-stack-auth.k6.js`
- `docs/k6/chat-stack-concurrency.k6.js`

Read this top to bottom once, then use it as a checklist per test session.

## 0. What's being tested

`V168` shortens 13 config keys on stage only (idle timeout, SSE timeouts, classifier/summarizer
LLM timeouts, Camunda servlet-bound bulkhead + rate limit) so the chat stack's timeout/resilience
paths are reachable in seconds instead of requiring multi-minute real waits. This flow walks
through triggering each one and confirming the expected behavior.

## 1. Prerequisites

- Two real email addresses with visit history on stage (`eligible: true` on
  `check-eligibility`). One is enough for most scenarios; the second is only needed for the
  bulkhead test (scenario 4 below).
- Postman (v10+ recommended — some pre-request scripts use `await`) and/or `k6` installed.
- Network access to `https://stg-modulith.naitive.ai` (or whichever stage host you're pointed at).

## 2. Get credentials (auth flow)

OTP delivery needs a human to read an inbox, so this step can't be fully scripted — pick one path
per user and do it before anything else.

**Postman** — run folder **A. Auth (User A)** in order:
1. `A1. Check eligibility` (sends the OTP) → set `otp_code` from the email you receive
2. `A2. Exchange OTP for token` → saves `access_token`
3. `A3. Resolve visit_id` → saves `visit_id`

**k6** (two-phase, since OTP needs a human in between):
```bash
k6 run -e AUTH_EMAIL=you@example.com docs/k6/chat-stack-auth.k6.js
# check inbox, then:
k6 run -e AUTH_EMAIL=you@example.com -e OTP_CODE=123456 docs/k6/chat-stack-auth.k6.js
```
Copy the printed `ACCESS_TOKEN=...` / `VISIT_ID=...` block.

Repeat with a second email for **User B** — Postman folder **B. Auth (User B)**, or k6 with
`-e LABEL=userB` — only if you're planning to run the bulkhead test (scenario 4, §4).

## 3. Start a conversation

Every scenario needs a real, pre-existing conversation — `conversationId` isn't something you can
make up client-side (`.../orchestration/{id}/start` 404s otherwise).

**Postman**: run both requests in folder **0. Shared** (Create conversation → Start orchestration).
This is what most scenario folders below expect to already have run.

**k6**: `chat-stack-concurrency.k6.js` creates its own conversations per scenario internally — no
separate step needed once you have `ACCESS_TOKEN`/`VISIT_ID`.

## 4. Run the scenarios — recommended order

**Important sequencing constraint:** folders 1 and 7 each deliberately *end* the shared
conversation's session (idle timeout fires / rollover is triggered). Folders 2, 3, 5, and 6 need
that session to still be ACTIVE. So don't run 1 or 7 in the middle of the group below — each of
them needs its **own fresh conversation** (re-run folder 0 right before it). Concretely:

1. **Run folder 0 once** → `conversation_id` (call this "session A").
2. Against session A, run, in any order: **6** (classifier), **2** (SSE emitter/replay), and **5**
   (rate limit). None of these end the session.
3. **Re-run folder 0** → `conversation_id` now points to a fresh "session B".
4. Run **1** (idle timeout) against session B — this ends it. Don't reuse `conversation_id` for
   anything else afterward.
5. **Re-run folder 0** → fresh "session C".
6. Build 10-15 turns of history on session C (folder 2's follow-up body via Collection Runner),
   then run **7** (summarizer) last — it also ends/rolls over the session.
7. **k6** `chat-stack-concurrency.k6.js` for **3 + 5 + 4** — independent of the above, it creates
   its own conversations internally. Run it any time; it's the deterministic version of 3/5/4.
8. **Folder 8** (infra-dependent) — not tool-triggerable at all; do this operationally whenever.

| # | Scenario | Tool | Notes |
|---|---|---|---|
| 6 | Classifier LLM timeout / circuit breaker | Postman folder 6 | Load-dependent (needs real OpenAI latency) — give it the most attempts/re-runs. Requires a multi-route persona; may not fire on a given run. |
| 2 | SSE emitter timeout + replay cache | Postman folder 2 | Manual timing (stopwatch or `curl -N`) — not automated. |
| 5 | Per-client rate limit (2/5s) | Postman folder 5, or **k6** (step 7) | Needs only User A. **✅ Confirmed on stage 2026-08-30** — 3rd call in-window got `429 PER_CLIENT_RATE_LIMIT`. |
| 3 | Max concurrent SSE streams (cap=2) | **k6** (step 7), or Postman folder 3 | k6 opens 3 genuinely concurrent streams on 3 distinct conversations; Postman's version is best-effort. **✅ Confirmed on stage 2026-08-30** — 3rd stream got the cap-rejection body, cap held at ≤2 admitted. |
| 4 | Bulkhead exhaustion (pool=1+queue=2) | **k6** (step 7, needs `ACCESS_TOKEN_2`/`VISIT_ID_2`), or Postman folder 4 | Needs TWO users — a single client's own rate limit masks this test otherwise. Skips itself with a warning if only one user is provided. **✅ Confirmed on stage 2026-08-30** — 4th concurrent call (2 per user) got `503 SERVLET_BOUND_TIMEOUT`, first 3 admitted. |
| 1 | Idle-session timeout (15s) | Postman folder 1 | Needs its own fresh conversation (step 3-4 above) — running it against session A would kill it before 2/5/6 get to use it. **✅ Confirmed on stage 2026-08-30** using `GET /v1/internal/chatting/conversations/{id}/sessions` (see §7): the old session hit `TIMED_OUT` ~19s after `startedAt` (not exactly 15s — the timer only starts once the process reaches its wait-gateway, *after* the agent's first turn finishes processing, adding a few seconds), and a follow-up sent afterward created a genuinely new session (new `processInstanceKey`) while the old one stayed `TIMED_OUT`, untouched. **Wait at least 25-30s, not 16s** — a 16s wait undershoots the real trigger point and just lands on the still-active session (tried this on 2026-08-30 and it did NOT roll over). |
| 7 | Summarizer LLM timeout (10s) | Postman folder 7 | Needs its own fresh conversation too (step 5-6). Load-dependent, same caveat as #6. Note: per the scenario-1 finding, a plain follow-up after idle timeout also triggers rollover (and the summarizer) — folder 7's explicit `/start` re-call isn't the only way to get there. |
| 8 | Join-timeout/retry exhaustion + HTTP-connector timeout | N/A — infra action | Not triggerable from either tool. See folder 8's README request for what to do operationally (restart/scale Zeebe or the modulith pod). |

**Single k6 command for #3+#5+#4 together** (recommended — deterministic, one run):
```bash
k6 run \
  -e ACCESS_TOKEN=<userA-token> -e VISIT_ID=<userA-visit> \
  -e ACCESS_TOKEN_2=<userB-token> -e VISIT_ID_2=<userB-visit> \
  docs/k6/chat-stack-concurrency.k6.js
```
Omit `ACCESS_TOKEN_2`/`VISIT_ID_2` to run #3 and #5 only (bulkhead test #4 self-skips with a
warning).

## 5. What to watch for while running

- `503` body code `SERVLET_BOUND_TIMEOUT` — bulkhead/servlet-bound wait exceeded.
- `429` body code `PER_CLIENT_RATE_LIMIT` — per-client budget exhausted.
- A follow-up after idle timeout does **NOT** fail: `ChattingOrchestrationService.sendAgentReply`
  can only take one of two branches (publish onto an existing active session, or
  `SessionLifecycleService.startOrPublishAfterRollover`), and both return the same `202` with
  nothing exposed to the client either way. A bare `202` therefore can't tell you *which* branch
  ran, or whether the idle timer actually fired within your wait — use the internal sessions
  endpoint in §7 to see that directly instead of guessing from the response code.
- Metrics: `chatting.camunda.servlet_bound_timeout`, `chatting.camunda.per_client_rate_limited`,
  `chatting.classifier.timeout`, `chatting.classifier.circuit_open`.
- Logs: `[step-svc] markSessionTerminal ... terminal=true` (idle timeout),
  `[camunda-bounded] ... rejected — pool/queue full` (bulkhead),
  `[classifier] timed out after 3s` / `circuit breaker ... -> OPEN` (classifier),
  `[resume-summarizer] LLM call timed out after 10s` (summarizer).

## 6. Re-running

- Tokens are valid for their TTL (~24h access / ~7d refresh) — don't repeat step 2 for every
  session, only when a token has expired or you need a fresh visit resolution.
- Each scenario in §4 that needs a fresh conversation says so in its own folder/script
  description — don't reuse a conversation whose session already ended (idle timeout, rollover)
  for a different scenario.
- If a concurrency scenario (3, 4, or 5) doesn't trigger on a given run, re-run it — timing over
  real HTTP isn't perfectly deterministic even with k6's `http.batch()`.

## 7. Verifying session state directly (idle timeout / rollover)

`ConversationTurnDto` (the only thing the secure `/turns` endpoint exposes) is deliberately
session-agnostic — it can't tell you whether a conversation's session ended and rolled over.
`GET /v1/internal/chatting/conversations/{conversationId}/sessions` closes that gap: it returns
every session for a conversation, oldest first, with `status`, `processInstanceKey`, `startedAt`,
and `endedAt`. This is an internal (network-trust, no JWT) endpoint — call it directly, no
`Authorization` header.

**Confirmed on stage 2026-08-30**, this is what a genuine idle-timeout + rollover looks like:

```
Right after /start:
  session A: status=ACTIVE, pik=...4437, endedAt=null

~19s after startedAt (idle timer fired — note this is startedAt + ~19s, not exactly the
configured PT15S, because the timer only starts once the process reaches its wait-gateway,
*after* the agent's first turn finishes processing):
  session A: status=TIMED_OUT, pik=...4437 (unchanged), endedAt=<~19s after startedAt>

After a follow-up sent post-timeout:
  session A: status=TIMED_OUT, endedAt unchanged   <- old session, untouched
  session B: status=ACTIVE, pik=...4740 (NEW), endedAt=null   <- rollover created this
```

**Practical takeaway for folder 1 / scenario 1: wait at least 25-30 seconds, not 16.** A 16s wait
undershoots the real trigger point (confirmed by testing both — 16s left the session still
`ACTIVE` with no rollover; 20-35s reliably showed `TIMED_OUT` + a new session). If you want to
watch the exact transition, poll this endpoint every few seconds instead of guessing a fixed wait.

---

## 8. Student / visitor chat smoke (Vite SPA)

Guest / public chatting is **gone** — always JWT. Use `npm run dev` against a modulith that has
student absence + visitor experience enabled.

### Visitor regression

1. Sign in with an email that has visit history and **no** student roster (or both — pick **Visitor**).
2. OTP must succeed without a ~15s stall when visits are empty for student-only accounts (see next).
3. Empty state shows Visitor Experience / catering-style quick prompts.
4. Start a chat → catering / IT / F&M still work; **no** attach control on visitor turns.
5. Sidebar badge: **Visit**.

### Student happy path

1. Sign in with a student-linked email. If my-visits is empty, login still succeeds (student-only);
   manual visit UUID form is hidden.
2. Persona auto-selects **Student** (or pick Student when both resolve). Empty state mentions absence /
   ABS- status via front door.
3. Prompt e.g. “I need to submit an absence”. The specialist calls Get Student Info first:
   - Banner unlinked → plain-text stop (Missing Banner). **No** reason menu, **no** attach control.
     Do not expect a 422 on `/info` — chat `/info` is 200 with `externalSystemUserId: null`.
   - Linked → reason menu (single-level).
4. Selection sends verbatim `[student_absence-menu] Selected Reason (... )`.
5. `date_request` for `dateFrom`, then `dateTo`. For `dateTo` + `afterDate`, picker `min` is the
   **next** calendar day. If the reason needs a file, the agent **announces** that in prose on the
   metadata/date turns — attach control stays hidden until after both dates.
6. If a document is required: `attachment_request` **after** `dateTo`. Cue names the date range.
   Upload returns `chatFollowUpMessage` sent **verbatim** (do not rebuild `[attachment]`).
   Bad MIME/size → **400** once; client also rejects >10 MB. Banner-unlinked at this stage is a
   fallback **422** (should be rare; the agent should have stopped at step 3).
7. Details → confirm (plain `subtype:"none"`). The confirmation question may shorten long echoes
   in `textString`; Create still uses full values — the UI just renders the bubble.
8. Ticket card title **Absence request submitted** for `ABS-*`.
9. Reload mid-`date_request` or mid-`attachment_request`: the matching control restores from the
   last AI turn without a new SSE.
10. Dual-persona: switch persona; other-context conversations are read-only; **New Chat** uses the
    active envelope. Env switch clears visitId, studentId, and activePersona.

### Orchestration start shapes

- VISIT: `chatContext.contextType = "VISIT"`, `contextData.id = <visitId from my-visits>`.
- STUDENT: `chatContext.contextType = "STUDENT"`, `contextData.id = <profile/me data.id>`
  (Identity user UUID — never roster PK / Banner).
