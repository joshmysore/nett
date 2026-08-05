import type { APIRequestContext } from "@playwright/test";

const API = "http://127.0.0.1:4174";

export type PersonRow = { id: string; name: string };

export async function waitForHealth(request: APIRequestContext, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await request.get(`${API}/api/health`);
      if (response.ok()) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("API health check failed");
}

export async function firstPerson(request: APIRequestContext): Promise<PersonRow> {
  const response = await request.get(`${API}/api/people/page?page=1&limit=1`);
  if (!response.ok()) throw new Error(`people page failed: ${response.status()}`);
  const payload = await response.json() as { people: PersonRow[]; total: number };
  if (!payload.people[0]) throw new Error("No people available for e2e");
  return payload.people[0];
}

export async function personMemoryCount(request: APIRequestContext, id: string) {
  const response = await request.get(`${API}/api/people/${id}`);
  if (!response.ok()) throw new Error(`person fetch failed: ${response.status()}`);
  const person = await response.json() as { memories?: unknown[] };
  return Array.isArray(person.memories) ? person.memories.length : 0;
}

export async function parseMemory(request: APIRequestContext, text: string) {
  const response = await request.post(`${API}/api/memories/parse`, {
    data: { text },
  });
  if (!response.ok()) throw new Error(`parse failed: ${response.status()}`);
  return response.json();
}

export async function platformStatus(request: APIRequestContext) {
  const response = await request.get(`${API}/api/platform/status`);
  if (!response.ok()) throw new Error(`platform status failed: ${response.status()}`);
  return response.json() as Promise<{
    accounts: Array<{ connectorId: string; accountId: string; authState: string; settings: Record<string, unknown> }>;
  }>;
}

export async function patchPerson(
  request: APIRequestContext,
  id: string,
  input: Record<string, unknown>,
) {
  const response = await request.patch(`${API}/api/people/${id}`, { data: input });
  if (!response.ok()) throw new Error(`patch failed: ${response.status()}`);
  return response.json();
}
