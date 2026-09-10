import http from 'k6/http';
import {check} from 'k6';

/**
 * @fileoverview Companion helper for {@link ./chat-stack-concurrency.k6.js}: obtains a real
 * ACCESS_TOKEN + VISIT_ID for stage via the same email-OTP flow this frontend uses in the
 * browser — see `src/auth/otpAccessTokenFlow.js` and `src/auth/visitResolution.js`.
 *
 * OTP delivery is inherently a human-in-the-loop step (a real inbox has to receive the code), so
 * this is a TWO-PHASE script run twice, not a single unattended run:
 *
 * Phase 1 (no OTP_CODE) — sends the OTP:
 * ```
 * k6 run -e AUTH_EMAIL=you@example.com docs/k6/chat-stack-auth.k6.js
 * ```
 *
 * Phase 2 (with OTP_CODE from that inbox) — exchanges it and resolves visit_id:
 * ```
 * k6 run -e AUTH_EMAIL=you@example.com -e OTP_CODE=123456 docs/k6/chat-stack-auth.k6.js
 * ```
 *
 * Phase 2 prints a copy-pasteable `ACCESS_TOKEN=...` / `VISIT_ID=...` block for
 * `chat-stack-concurrency.k6.js`. Run the whole thing twice (different AUTH_EMAIL, different
 * LABEL) to get the second user `chat-stack-concurrency.k6.js` needs for its bulkhead test:
 *
 * ```
 * k6 run -e AUTH_EMAIL=userB@example.com -e LABEL=userB docs/k6/chat-stack-auth.k6.js
 * k6 run -e AUTH_EMAIL=userB@example.com -e OTP_CODE=654321 -e LABEL=userB docs/k6/chat-stack-auth.k6.js
 * ```
 *
 * Codes are short-lived and single-use (mirrors `otpAccessTokenFlow.js`) — if phase 2 fails with
 * an exchange error, re-run phase 1 for a fresh code rather than retrying the same one.
 */

/** Backend base URL. Defaults to stage. */
const BASE_URL = __ENV.BASE_URL || 'https://stg-modulith.naitive.ai';
/** Email to authenticate as. Required — must have visit history on this backend. */
const AUTH_EMAIL = __ENV.AUTH_EMAIL;
/** OTP code from the inbox. Empty in phase 1, set in phase 2. */
const OTP_CODE = __ENV.OTP_CODE || '';
/** Distinguishes concurrent runs (e.g. `primary` vs `userB`) in console output and printed var names. */
const LABEL = __ENV.LABEL || 'primary';

if (!AUTH_EMAIL) {
    throw new Error('Set -e AUTH_EMAIL=<email> (must have visit history on this backend)');
}

export const options = {
    scenarios: {
        auth_flow: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '30s',
        },
    },
};

const JSON_HEADERS = {'Content-Type': 'application/json'};

/**
 * Extracts the same error shape `otpAccessTokenFlow.js`'s `postJson()` looks for, so failures
 * here surface the same message the real frontend would show.
 *
 * @param {import('k6/http').RefinedResponse} res - k6 HTTP response.
 * @returns {string} `body.message`, `body.error_description`, or `body.error` if present and the
 *   body parses as JSON; otherwise `"HTTP <status>"`.
 */
function errorMessage(res) {
    let body = null;
    try {
        body = res.json();
    } catch {
        body = null;
    }
    return (body && (body.message || body.error_description || body.error)) || `HTTP ${res.status}`;
}

/**
 * Mirrors `otpAccessTokenFlow.js#prepareOtpChallenge`: checks OTP eligibility and, if eligible,
 * triggers the OTP send to {@link AUTH_EMAIL}. Logs the sent confirmation on success.
 *
 * @returns {void}
 * @throws {Error} If the eligibility check itself fails (non-200), or if the backend reports the
 *   email as ineligible (no account/visit history).
 */
function checkEligibilityAndSendOtp() {
    const res = http.post(
        `${BASE_URL}/api/v1/public/visitor-management/check-eligibility`,
        JSON.stringify({email: AUTH_EMAIL}),
        {headers: JSON_HEADERS}
    );
    check(res, {'check-eligibility OK': (r) => r.status === 200});
    if (res.status !== 200) {
        throw new Error(`check-eligibility failed: ${errorMessage(res)}`);
    }
    const data = res.json().data;
    if (data && data.eligible === false) {
        throw new Error(`${AUTH_EMAIL} is NOT eligible for OTP (no account/visit history on this backend)`);
    }
    console.log(`[${LABEL}] OTP sent to ${AUTH_EMAIL} — reasons=${JSON.stringify(data && data.reasons)}`);
}

/**
 * Mirrors `otpAccessTokenFlow.js#exchangeOtpForToken`: exchanges {@link OTP_CODE} for a real
 * access token.
 *
 * @returns {{accessToken: string, refreshToken: (string|undefined), expiresIn: (number|undefined)}}
 *   The issued token bundle.
 * @throws {Error} If the exchange call fails (non-200) or the response has no `access_token`
 *   (code stale/already used — re-run phase 1 for a fresh one).
 */
function exchangeOtpForToken() {
    const res = http.post(
        `${BASE_URL}/api/v1/public/identity/auth/otp/email/token`,
        JSON.stringify({email: AUTH_EMAIL, code: OTP_CODE}),
        {headers: JSON_HEADERS}
    );
    check(res, {'otp exchange accepted': (r) => r.status === 200});
    if (res.status !== 200) {
        throw new Error(`OTP exchange failed: ${errorMessage(res)} — code may be stale, re-run phase 1 for a fresh one`);
    }
    const data = res.json().data;
    if (!data || !data.access_token) {
        throw new Error('No access_token in OTP exchange response');
    }
    return {accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in};
}

/**
 * Mirrors `visitResolution.js#fetchVisitIdFromMyVisitsLists`: tries the visitor's `all`,
 * `upcoming`, then `past` visit lists in order and returns the first visit id found.
 *
 * @param {string} accessToken - Bearer token from {@link exchangeOtpForToken}.
 * @returns {(string|null)} The first `visitId` found across the three lists, or `null` if none
 *   have any visits yet (e.g. post-login sync still catching up).
 */
function resolveVisitId(accessToken) {
    const paths = [
        '/api/v1/secure/visitor-management/my-visits?page=0&size=5',
        '/api/v1/secure/visitor-management/my-visits/upcoming?page=0&size=5',
        '/api/v1/secure/visitor-management/my-visits/past?page=0&size=5',
    ];
    for (const path of paths) {
        const res = http.get(`${BASE_URL}${path}`, {headers: {Authorization: `Bearer ${accessToken}`}});
        if (res.status !== 200) continue;
        const data = res.json().data;
        const content = data && data.content;
        if (Array.isArray(content) && content.length > 0 && content[0].visitId) {
            return content[0].visitId;
        }
    }
    return null;
}

/**
 * k6 VU entry point. Phase-switches on whether {@link OTP_CODE} is set:
 *
 * - **Phase 1** (no `OTP_CODE`): sends the OTP via {@link checkEligibilityAndSendOtp} and prints
 *   the phase-2 command to run once the code arrives, then returns — it deliberately does NOT
 *   proceed to exchange, since sending a fresh OTP would invalidate any code already in flight.
 * - **Phase 2** (`OTP_CODE` set): exchanges the code for a token via {@link exchangeOtpForToken},
 *   resolves a visit id via {@link resolveVisitId}, and prints a copy-pasteable
 *   `ACCESS_TOKEN=... VISIT_ID=...` block (suffixed `_2` when `LABEL` isn't `primary`) for use
 *   with `chat-stack-concurrency.k6.js`.
 *
 * @returns {void}
 */
export default function () {
    if (!OTP_CODE) {
        // Phase 1 only: sending a fresh OTP invalidates any code already in flight, so this must
        // NOT run again in phase 2 — otherwise the code just entered would already be stale by the
        // time exchangeOtpForToken() below tries to use it.
        checkEligibilityAndSendOtp();
        console.log(`\n[${LABEL}] Check the ${AUTH_EMAIL} inbox for the OTP code, then re-run:`);
        console.log(
            `  k6 run -e BASE_URL=${BASE_URL} -e AUTH_EMAIL=${AUTH_EMAIL} -e OTP_CODE=<code-from-email> -e LABEL=${LABEL} docs/k6/chat-stack-auth.k6.js`
        );
        return;
    }

    const {accessToken, refreshToken, expiresIn} = exchangeOtpForToken();
    console.log(`[${LABEL}] access_token acquired (expires_in=${expiresIn}, hasRefreshToken=${Boolean(refreshToken)})`);

    const visitId = resolveVisitId(accessToken);
    if (!visitId) {
        console.warn(
            `[${LABEL}] No visit found yet across my-visits/upcoming/past. Post-login sync can lag a few ` +
            'seconds. The OTP code is one-time-use so you can\'t re-run this script to retry — instead, ' +
            'wait a few seconds and retry the my-visits call directly with the ACCESS_TOKEN printed ' +
            'below (it stays valid for its full TTL), e.g.:\n' +
            `  curl -H "Authorization: Bearer ${accessToken}" "${BASE_URL}/api/v1/secure/visitor-management/my-visits?page=0&size=5"\n` +
            'or set VISIT_ID manually if you already know it.'
        );
    }

    const varSuffix = LABEL === 'primary' ? '' : '_2';
    console.log('\n============================================================');
    console.log(`AUTH COMPLETE (label=${LABEL})`);
    console.log(`ACCESS_TOKEN${varSuffix}=${accessToken}`);
    console.log(`VISIT_ID${varSuffix}=${visitId || '(not resolved — see warning above)'}`);
    if (refreshToken) console.log(`REFRESH_TOKEN${varSuffix}=${refreshToken}`);
    console.log('\nUse with chat-stack-concurrency.k6.js, e.g.:');
    if (varSuffix === '') {
        console.log(`  -e ACCESS_TOKEN=${accessToken} -e VISIT_ID=${visitId || '<paste-manually>'}`);
    } else {
        console.log(`  -e ACCESS_TOKEN_2=${accessToken} -e VISIT_ID_2=${visitId || '<paste-manually>'}`);
    }
    console.log('============================================================\n');
}
