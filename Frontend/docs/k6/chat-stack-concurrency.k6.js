import http from 'k6/http';
import {check, sleep} from 'k6';

/**
 * @fileoverview k6 script for the CONCURRENCY-based stage timeout/resilience scenarios called out
 * in `docs/postman/chat-stack-timeout-scenarios.postman_collection.json` (folders 3-5), driven
 * against the stage config seeded by `V168__common_modulith_stage_fast_timeouts_for_qa.sql`:
 *
 *   3. Max concurrent SSE streams per user   (`sse.max-emitters-per-user = 2`)
 *   4. Camunda servlet-bound bulkhead        (`servlet-bound-pool-size=1, queue-capacity=2`
 *                                              -> 3 max in-flight across the whole app)
 *   5. Per-client rate limit                 (`per-client-rate-limit-per-period=2 per 5s`)
 *
 * Unlike the Postman collection's `pm.sendRequest` trick, `http.batch()` below fires genuinely
 * concurrent requests over separate connections, so these are deterministic (as deterministic as
 * anything racing against a real server can be).
 *
 * IMPORTANT interactions to understand before reading the code:
 *
 * - `conversationId` is NOT client-generated. {@link startConversation} below first calls
 *   `POST /api/v1/secure/chatting/conversations` to create a real conversation (+ its initial
 *   session) owned by the caller, then calls `.../orchestration/conversations/{id}/start` on that
 *   id. Skipping straight to `/start` with a made-up UUID 404s every time
 *   (`ChattingEntityLoader#requireConversationForClientUpdate`). The create-conversation call is
 *   NOT gated by `PerClientRateLimiterGuard` (that guard only wraps the chattingorchestration
 *   endpoints), so it doesn't consume any of the budget discussed below.
 *
 * - `PerClientRateLimiterGuard.acquireOrThrow(clientId)` runs at the top of BOTH
 *   `startOrchestrationWithChatContext()` and `sendAgentReply()` (`ChattingOrchestrationService`),
 *   sharing ONE 2-per-5s budget per client across start + every follow-up. Calling `start()`
 *   spends one of that client's two permits. The tests below sleep past the 5s refresh window
 *   wherever a client needs its full budget available, and the bulkhead test uses TWO separate
 *   users specifically so neither user's own rate limit gets in the way of a genuine 4-way race
 *   for the bulkhead's shared capacity of 3.
 *
 * - `AgentResponsePushService` keeps only ONE live emitter per `conversationId` (a 2nd subscribe
 *   on the same `conversationId` completes/replaces the 1st — see `"REPLACED_PRIOR_EMITTER"` in
 *   its logs). To test the per-USER cap and not this per-conversation replacement behavior, the
 *   SSE test opens 3 DIFFERENT conversations for the same user rather than 3 parallel opens on
 *   one conversation.
 *
 * - When the per-user SSE cap is exceeded, the server does NOT reject the HTTP request — it
 *   returns 200 with an immediately-completed SSE body containing a single ERROR event
 *   (`"Too many concurrent assistant streams for this client."`), per
 *   `AgentResponsePushService#subscribeSseByConversation`. An admitted stream instead stays open
 *   past our 5s client-side timeout (well short of its real ~20s server-side
 *   `sse.emitter-timeout-ms`), so k6 reports it as a request error with status 0.
 *
 * Don't have ACCESS_TOKEN / VISIT_ID yet? Run `docs/k6/chat-stack-auth.k6.js` first — it drives
 * the same email-OTP flow this frontend uses (check-eligibility -> OTP exchange -> resolve visit
 * id) and prints a copy-pasteable `ACCESS_TOKEN=.../VISIT_ID=...` block. Run it twice (two
 * different emails, `LABEL=primary` and `LABEL=userB`) to get both users this script needs.
 *
 * Usage:
 * ```
 * k6 run \
 *   -e BASE_URL=https://stg-modulith.naitive.ai \
 *   -e ACCESS_TOKEN=<jwt> -e VISIT_ID=<uuid-owned-by-that-user> \
 *   [-e ACCESS_TOKEN_2=<jwt-for-a-different-user> -e VISIT_ID_2=<uuid-owned-by-that-user>] \
 *   docs/k6/chat-stack-concurrency.k6.js
 * ```
 *
 * `ACCESS_TOKEN_2` / `VISIT_ID_2` are optional but required for the bulkhead test (#4) to mean
 * anything — without a second, distinct client, that test is skipped with a warning explaining
 * why (see {@link testBulkheadExhaustion}).
 */

/**
 * A single request entry for k6's `http.batch()`, in `[method, url, body, params]` tuple form.
 * @typedef {[string, string, (string|null), Object]} K6BatchRequest
 */

/** Backend base URL. Defaults to stage. */
const BASE_URL = __ENV.BASE_URL || 'https://stg-modulith.naitive.ai';
/** Bearer token for the primary test user. Required. */
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN;
/** Visit id owned by {@link ACCESS_TOKEN}'s user, used as chat context. Required. */
const VISIT_ID = __ENV.VISIT_ID;
/** Bearer token for a second, distinct test user. Optional — only needed for the bulkhead test. */
const ACCESS_TOKEN_2 = __ENV.ACCESS_TOKEN_2 || '';
/** Visit id owned by {@link ACCESS_TOKEN_2}'s user. Optional — pairs with `ACCESS_TOKEN_2`. */
const VISIT_ID_2 = __ENV.VISIT_ID_2 || '';

if (!ACCESS_TOKEN) {
    throw new Error('Set -e ACCESS_TOKEN=<jwt> for a real authenticated user');
}
if (!VISIT_ID) {
    throw new Error("Set -e VISIT_ID=<uuid> for a visit owned by ACCESS_TOKEN's user");
}

export const options = {
    scenarios: {
        concurrency_burst: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '2m',
        },
    },
    thresholds: {
        // Don't fail the whole run over any single scenario's check (e.g. the bulkhead test
        // being skipped when ACCESS_TOKEN_2 is absent) — read the console output per scenario.
        checks: ['rate>=0'],
    },
};

/**
 * Builds the standard bearer-auth + JSON headers, merged with any request-specific extras.
 *
 * @param {string} token - Bearer token.
 * @param {Object} [extra] - Additional headers to merge in (e.g. `{ Accept: 'text/event-stream' }`).
 * @returns {Object} Combined headers object.
 */
function authHeaders(token, extra) {
    return Object.assign(
        {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        extra || {}
    );
}

/**
 * Creates a new conversation (and its initial session) owned by `token`'s user.
 *
 * Conversations are NOT client-generated ids: `ensureActiveOrchestrationSessionInTransaction`
 * calls `entityLoader.requireConversationForClientUpdate(conversationId, ...)`, which 404s
 * (`ResourceNotFoundException`) unless a `chatting.conversations` row with that id already
 * exists, owned by this client. A conversation must be created via
 * `POST .../chatting/conversations` first; `/start` only correlates the first message onto the
 * session that create step already made.
 *
 * @param {string} token - Bearer token identifying the owning user.
 * @param {string} label - Scenario label, used for the conversation title and check/log names.
 * @returns {(string|null)} The new conversation id, or `null` if creation failed (logged via
 *   `console.error`).
 */
function createConversation(token, label) {
    const url = `${BASE_URL}/api/v1/secure/chatting/conversations`;
    const body = JSON.stringify({initialTitle: `k6 ${label}`, initialSummary: null});
    const res = http.post(url, body, {headers: authHeaders(token)});
    const ok = check(res, {[`${label}: create conversation accepted`]: (r) => r.status === 200 || r.status === 201});
    if (!ok) {
        console.error(`${label}: create conversation FAILED status=${res.status} body=${res.body}`);
        return null;
    }
    return JSON.parse(res.body).data.id;
}

/**
 * Creates a conversation via {@link createConversation}, then starts orchestration on it with a
 * VISIT chat context.
 *
 * @param {string} token - Bearer token identifying the owning user.
 * @param {string} visitId - Visit id to attach as the conversation's chat context.
 * @param {string} label - Scenario label, used for the conversation title and check/log names.
 * @returns {string} The started conversation's id.
 * @throws {Error} If conversation creation fails.
 */
function startConversation(token, visitId, label) {
    const conversationId = createConversation(token, label);
    if (!conversationId) {
        throw new Error(`${label}: could not create conversation, aborting`);
    }
    const url = `${BASE_URL}/api/v1/secure/chatting/orchestration/conversations/${conversationId}/start`;
    const body = JSON.stringify({
        inputText: 'k6 concurrency test',
        chatContext: {
            schemaVersion: '1.0',
            contextType: 'VISIT',
            contextData: {id: visitId},
        },
        displayText: null,
    });
    const res = http.post(url, body, {headers: authHeaders(token)});
    check(res, {[`${label}: start accepted`]: (r) => r.status === 200 || r.status === 201});
    if (res.status !== 200 && res.status !== 201) {
        console.error(`${label}: start FAILED status=${res.status} body=${res.body}`);
    }
    return conversationId;
}

/**
 * Builds a `k6.http.batch()` request entry for a follow-up user message on an already-started
 * conversation. Does not execute the request — caller batches it alongside others.
 *
 * @param {string} token - Bearer token.
 * @param {string} conversationId - Target conversation, from {@link startConversation}.
 * @param {string} text - Follow-up message text.
 * @returns {K6BatchRequest} Request tuple for `http.batch()`.
 */
function followUpRequest(token, conversationId, text) {
    const url = `${BASE_URL}/api/v1/secure/chatting/orchestration/conversations/${conversationId}/user-messages`;
    const body = JSON.stringify({followUpInput: text, displayText: null, clientMessageId: null});
    return ['POST', url, body, {headers: authHeaders(token)}];
}

/**
 * Builds a `k6.http.batch()` request entry that opens the assistant-round SSE stream for a
 * conversation. Does not execute the request — caller batches it alongside others. Uses a 5s
 * client-side timeout, deliberately shorter than the server's real `sse.emitter-timeout-ms`
 * (~20s), so an admitted (not cap-rejected) stream shows up as a status-0 error rather than
 * blocking the batch for the server's full timeout.
 *
 * @param {string} token - Bearer token.
 * @param {string} conversationId - Target conversation, from {@link startConversation}.
 * @returns {K6BatchRequest} Request tuple for `http.batch()`.
 */
function streamRequest(token, conversationId) {
    const url = `${BASE_URL}/api/v1/secure/chatting/orchestration/conversations/${conversationId}/assistant-round/stream`;
    return ['GET', url, null, {headers: authHeaders(token, {Accept: 'text/event-stream'}), timeout: '5s'}];
}

/**
 * Scenario 3: max concurrent SSE streams per user (`sse.max-emitters-per-user = 2`).
 *
 * Opens 3 DIFFERENT conversations for {@link ACCESS_TOKEN}'s user (see the per-conversation vs.
 * per-user note in the file overview for why 3 conversations, not 3 opens on 1 conversation),
 * then fires all 3 stream requests concurrently via `http.batch()` and asserts: at most 2 stay
 * open past the client timeout, and at least one is rejected by the cap.
 *
 * @returns {void}
 */
function testMaxConcurrentSse() {
    console.log('\n--- 3. Max concurrent SSE streams per user (cap = 2) ---');
    const conv1 = startConversation(ACCESS_TOKEN, VISIT_ID, 'sse-1');
    const conv2 = startConversation(ACCESS_TOKEN, VISIT_ID, 'sse-2');
    sleep(6); // reset this client's 5s rate-limit window before spending a 3rd start permit
    const conv3 = startConversation(ACCESS_TOKEN, VISIT_ID, 'sse-3');
    sleep(1);

    const responses = http.batch([
        streamRequest(ACCESS_TOKEN, conv1),
        streamRequest(ACCESS_TOKEN, conv2),
        streamRequest(ACCESS_TOKEN, conv3),
    ]);

    let rejectedByCap = 0;
    let heldOpen = 0;
    responses.forEach((res, i) => {
        const wasRejected =
            res.status === 200 && res.body && res.body.includes('Too many concurrent assistant streams');
        const stillOpenAtClientTimeout = res.status === 0;
        if (wasRejected) rejectedByCap++;
        if (stillOpenAtClientTimeout) heldOpen++;
        console.log(
            `  stream ${i}: status=${res.status} rejectedByCap=${wasRejected} ` +
            `heldOpenPastClientTimeout=${stillOpenAtClientTimeout} error=${res.error || ''}`
        );
    });
    check(null, {
        'sse cap: at most 2 streams held open': () => heldOpen <= 2,
        'sse cap: at least one stream rejected once the cap is exceeded': () => rejectedByCap > 0,
    });
}

/**
 * Scenario 5: per-client rate limit (2 requests per 5s window).
 *
 * `start()` already spent 1 of this client's 2 permits in the current window (see
 * {@link startConversation} and the `PerClientRateLimiterGuard` note in the file overview), so
 * firing 2 more concurrent follow-ups right after leaves only 1 permit for 2 requests — at least
 * one should come back `429 PER_CLIENT_RATE_LIMIT`.
 *
 * @param {string} conversationId - An already-started conversation (its owning client's rate
 *   budget must still have 1 permit spent from `start()` in the current 5s window).
 * @returns {void}
 */
function testRateLimit(conversationId) {
    console.log('\n--- 5. Per-client rate limit (2 per 5s) ---');
    const responses = http.batch([
        followUpRequest(ACCESS_TOKEN, conversationId, 'rate-limit burst A'),
        followUpRequest(ACCESS_TOKEN, conversationId, 'rate-limit burst B'),
    ]);
    let limited = 0;
    responses.forEach((res, i) => {
        const isLimited = res.status === 429 && res.body && res.body.includes('PER_CLIENT_RATE_LIMIT');
        if (isLimited) limited++;
        console.log(`  call ${i}: status=${res.status} rateLimited=${isLimited}`);
    });
    check(null, {'rate limit: at least one 429 PER_CLIENT_RATE_LIMIT': () => limited > 0});
}

/**
 * Scenario 4: Camunda servlet-bound bulkhead exhaustion (`pool=1, queue=2` -> 3 max in-flight
 * across the whole app).
 *
 * Needs 2 DISTINCT clients ({@link ACCESS_TOKEN}/{@link VISIT_ID} and
 * {@link ACCESS_TOKEN_2}/{@link VISIT_ID_2}) so neither one's own 2-per-5s rate limit gets in the
 * way of a genuine 4-way race for the shared bulkhead's capacity of 3. Skips with a warning if
 * the second user's credentials aren't provided, since a single client can't cleanly trigger
 * this (its own rate limit would kick in first).
 *
 * @returns {void}
 */
function testBulkheadExhaustion() {
    console.log('\n--- 4. Camunda servlet-bound bulkhead exhaustion (max 3 in-flight) ---');
    if (!ACCESS_TOKEN_2 || !VISIT_ID_2) {
        console.warn(
            'SKIPPED: set ACCESS_TOKEN_2 and VISIT_ID_2 (a second, different user) to run this test.\n' +
            "A single client can't cleanly trigger this: PerClientRateLimiterGuard only allows 2 calls " +
            "per 5s per client, so a lone client's burst gets rate-limited before it can even reach " +
            'the bulkhead.'
        );
        return;
    }
    const convA = startConversation(ACCESS_TOKEN, VISIT_ID, 'bulkhead-userA');
    const convB = startConversation(ACCESS_TOKEN_2, VISIT_ID_2, 'bulkhead-userB');
    sleep(6); // reset both clients' rate-limit windows so all 4 follow-ups below reach the bulkhead

    const responses = http.batch([
        followUpRequest(ACCESS_TOKEN, convA, 'bulkhead burst A1'),
        followUpRequest(ACCESS_TOKEN, convA, 'bulkhead burst A2'),
        followUpRequest(ACCESS_TOKEN_2, convB, 'bulkhead burst B1'),
        followUpRequest(ACCESS_TOKEN_2, convB, 'bulkhead burst B2'),
    ]);
    let rejected = 0;
    responses.forEach((res, i) => {
        const wasRejected = res.status === 503 && res.body && res.body.includes('SERVLET_BOUND_TIMEOUT');
        if (wasRejected) rejected++;
        console.log(`  call ${i}: status=${res.status} bulkheadRejected=${wasRejected}`);
    });
    check(null, {'bulkhead: at least one 503 SERVLET_BOUND_TIMEOUT': () => rejected > 0});
}

/**
 * k6 VU entry point. Runs the three concurrency scenarios in sequence, sleeping 6s between them
 * to let the primary client's 5s rate-limit window reset before the next scenario's requests:
 *
 * 1. {@link testMaxConcurrentSse} — scenario 3 (SSE cap).
 * 2. {@link testRateLimit} — scenario 5 (per-client rate limit), against a freshly-started
 *    conversation.
 * 3. {@link testBulkheadExhaustion} — scenario 4 (servlet-bound bulkhead), if a second user's
 *    credentials were provided.
 *
 * @returns {void}
 */
export default function () {
    testMaxConcurrentSse();
    sleep(6); // reset the primary client's rate-limit window before the next scenario

    const rateLimitConv = startConversation(ACCESS_TOKEN, VISIT_ID, 'rate-limit-setup');
    testRateLimit(rateLimitConv);
    sleep(6);

    testBulkheadExhaustion();
}
