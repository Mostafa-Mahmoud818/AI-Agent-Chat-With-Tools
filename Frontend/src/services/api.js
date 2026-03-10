const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8081/api/chat';
const REQUEST_TIMEOUT_MS = 15_000;

class ApiError extends Error {
    constructor(status, errorCode, message) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
    }
}

async function handleResponse(res) {
    if (res.ok) return res;

    let errorCode = 'unknown';
    let message = `Request failed with status ${res.status}`;

    try {
        const body = await res.json();
        errorCode = body.error || errorCode;
        message = body.message || message;
    } catch {
        // response body wasn't JSON
    }

    throw new ApiError(res.status, errorCode, message);
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return fetch(url, { ...options, signal: controller.signal })
        .catch(err => {
            if (err.name === 'AbortError') {
                throw new ApiError(0, 'timeout', 'Request timed out. Please check your connection.');
            }
            throw new ApiError(0, 'network_error', 'Network error. Is the backend running?');
        })
        .finally(() => clearTimeout(timer));
}

async function post(path, body) {
    const res = await fetchWithTimeout(`${API_BASE}${path}`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
    });
    return handleResponse(res);
}

async function get(path) {
    const res = await fetchWithTimeout(`${API_BASE}${path}`);
    return handleResponse(res);
}

export async function startChat(inputText) {
    const res = await post('/start', { inputText });
    return res.json();
}

export async function getResponse(sessionId) {
    const res = await get(`/${sessionId}/response`);
    return res.json();
}

export async function sendReply(sessionId, followUpInput) {
    await post(`/${sessionId}/reply`, { followUpInput });
}

/**
 * Opens a Server-Sent Events stream for the given session.
 * The backend pushes a ChatResponseDTO JSON payload as each event's data.
 * Close the returned EventSource when done to prevent automatic reconnection.
 */
export function createResponseStream(sessionId) {
    return new EventSource(`${API_BASE}/${sessionId}/stream`);
}

export { ApiError };
