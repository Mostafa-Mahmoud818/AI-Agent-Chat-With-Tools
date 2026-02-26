const API_BASE = 'http://localhost:8081/api/chat';

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

async function post(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
    });
    return handleResponse(res);
}

async function get(path) {
    const res = await fetch(`${API_BASE}${path}`);
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

export { ApiError };
