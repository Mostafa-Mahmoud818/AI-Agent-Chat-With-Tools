const API_BASE = 'http://localhost:8081/api/chat';

export async function startChat(inputText) {
    const res = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputText }),
    });
    if (!res.ok) throw new Error('Failed to start chat');
    return res.json();
}

export async function getTasks(processInstanceKey) {
    const res = await fetch(`${API_BASE}/${processInstanceKey}/tasks`);
    if (!res.ok) throw new Error('Failed to fetch tasks');
    return res.json();
}

export async function completeTask(userTaskKey, variables) {
    const res = await fetch(`${API_BASE}/tasks/${userTaskKey}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables }),
    });
    if (!res.ok) throw new Error('Failed to complete task');
}
