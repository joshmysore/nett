import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type AskThreadSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type AskMessageContent = {
  text: string;
  people?: Array<{ id: string; name: string }>;
  abilities?: string[];
  stages?: Array<{ id: string; label: string; detail?: string }>;
  evidence?: Array<{ id: string; title: string; text: string }>;
  error?: string;
};

export type AskThreadMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: AskMessageContent;
  citations: unknown[];
  provider: string | null;
  createdAt: string;
};

export type AskThreadDetail = {
  thread: AskThreadSummary;
  messages: AskThreadMessage[];
};

type ThreadRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content_json: string;
  citations_json: string | null;
  provider: string | null;
  created_at: string;
};

export function titleFromAskQuery(query: string): string {
  const clean = query.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  if (clean.length <= 48) return clean;
  return `${clean.slice(0, 45).trimEnd()}…`;
}

function mapThread(row: ThreadRow): AskThreadSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function parseContent(raw: string): AskMessageContent {
  try {
    const value = JSON.parse(raw) as AskMessageContent;
    if (value && typeof value.text === "string") return value;
  } catch {
    /* fall through */
  }
  return { text: raw };
}

function parseCitations(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function mapMessage(row: MessageRow): AskThreadMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: parseContent(row.content_json),
    citations: parseCitations(row.citations_json),
    provider: row.provider,
    createdAt: row.created_at,
  };
}

export function listAskThreads(database: Database.Database, limit = 80): AskThreadSummary[] {
  const rows = database.prepare(
    `SELECT id, title, created_at, updated_at, archived_at
     FROM ask_threads
     WHERE archived_at IS NULL
     ORDER BY updated_at DESC
     LIMIT ?`
  ).all(limit) as ThreadRow[];
  return rows.map(mapThread);
}

export function getAskThread(database: Database.Database, id: string): AskThreadDetail | null {
  const row = database.prepare(
    `SELECT id, title, created_at, updated_at, archived_at FROM ask_threads WHERE id = ?`
  ).get(id) as ThreadRow | undefined;
  if (!row) return null;
  const messages = database.prepare(
    `SELECT id, thread_id, role, content_json, citations_json, provider, created_at
     FROM ask_messages
     WHERE thread_id = ?
     ORDER BY created_at ASC, rowid ASC`
  ).all(id) as MessageRow[];
  return { thread: mapThread(row), messages: messages.map(mapMessage) };
}

export function createAskThread(database: Database.Database, title = "New chat"): AskThreadSummary {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO ask_threads (id, title, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, NULL)`
  ).run(id, titleFromAskQuery(title) === "New chat" && title === "New chat" ? "New chat" : titleFromAskQuery(title), now, now);
  const created = getAskThread(database, id);
  if (!created) throw new Error("Failed to create Ask thread");
  return created.thread;
}

export function ensureAskThread(database: Database.Database, threadId?: string | null): AskThreadSummary {
  const id = String(threadId || "").trim();
  if (id) {
    const existing = getAskThread(database, id);
    if (existing && !existing.thread.archivedAt) return existing.thread;
  }
  return createAskThread(database);
}

export function renameAskThread(database: Database.Database, id: string, title: string): AskThreadSummary | null {
  const next = titleFromAskQuery(title);
  const result = database.prepare(
    `UPDATE ask_threads SET title = ?, updated_at = datetime('now') WHERE id = ? AND archived_at IS NULL`
  ).run(next, id);
  if (!result.changes) return null;
  return getAskThread(database, id)?.thread ?? null;
}

export function archiveAskThread(database: Database.Database, id: string): boolean {
  const result = database.prepare(
    `UPDATE ask_threads SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL`
  ).run(id);
  return result.changes > 0;
}

export function archiveAllAskThreads(database: Database.Database): number {
  const result = database.prepare(
    `UPDATE ask_threads SET archived_at = datetime('now') WHERE archived_at IS NULL`
  ).run();
  return result.changes;
}

export function appendAskMessage(
  database: Database.Database,
  input: {
    threadId: string;
    role: "user" | "assistant";
    content: AskMessageContent;
    citations?: unknown[];
    provider?: string | null;
    createdAt?: string;
  },
): AskThreadMessage {
  const id = randomUUID();
  const createdAt = input.createdAt || new Date().toISOString();
  database.prepare(
    `INSERT INTO ask_messages (id, thread_id, role, content_json, citations_json, provider, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.threadId,
    input.role,
    JSON.stringify(input.content),
    input.citations ? JSON.stringify(input.citations) : null,
    input.provider ?? null,
    createdAt,
  );
  database.prepare(
    `UPDATE ask_threads SET updated_at = ? WHERE id = ?`
  ).run(createdAt, input.threadId);
  return {
    id,
    threadId: input.threadId,
    role: input.role,
    content: input.content,
    citations: input.citations || [],
    provider: input.provider ?? null,
    createdAt,
  };
}

export function persistAskTurn(
  database: Database.Database,
  input: {
    threadId: string;
    query: string;
    people?: Array<{ id: string; name: string }>;
    abilities?: string[];
    answer: string;
    citations?: unknown[];
    stages?: AskMessageContent["stages"];
    evidence?: AskMessageContent["evidence"];
    provider?: string;
    error?: string;
  },
): { thread: AskThreadSummary; user: AskThreadMessage; assistant: AskThreadMessage } {
  const thread = ensureAskThread(database, input.threadId);
  if (thread.title === "New chat" && input.query.trim()) {
    renameAskThread(database, thread.id, input.query);
  }
  const user = appendAskMessage(database, {
    threadId: thread.id,
    role: "user",
    content: {
      text: input.query,
      people: input.people,
      abilities: input.abilities,
    },
  });
  const assistant = appendAskMessage(database, {
    threadId: thread.id,
    role: "assistant",
    content: {
      text: input.answer,
      stages: input.stages,
      evidence: input.evidence,
      error: input.error,
    },
    citations: input.citations,
    provider: input.provider,
  });
  const latest = getAskThread(database, thread.id);
  return { thread: latest?.thread ?? thread, user, assistant };
}

export function persistAskUserMessage(
  database: Database.Database,
  input: {
    threadId: string;
    query: string;
    people?: Array<{ id: string; name: string }>;
    abilities?: string[];
  },
): { thread: AskThreadSummary; user: AskThreadMessage } {
  const thread = ensureAskThread(database, input.threadId);
  if (thread.title === "New chat" && input.query.trim()) {
    renameAskThread(database, thread.id, input.query);
  }
  const user = appendAskMessage(database, {
    threadId: thread.id,
    role: "user",
    content: {
      text: input.query,
      people: input.people,
      abilities: input.abilities,
    },
  });
  const latest = getAskThread(database, thread.id);
  return { thread: latest?.thread ?? thread, user };
}
