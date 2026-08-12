import express from "express";
import multer from "multer";
import Fuse from "fuse.js";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import {
  connectors,
  messagesDatabaseStatus,
  prepareLocalMessagesCopy,
  prepareWhatsAppArchive,
  whatsappDesktopStatus
} from "./connectors.js";
import { addMemory, connectorStates, createPerson, db, findExactPerson, getPeople, getPeoplePage, getPerson, getPersonCommunications, listify, mergeReviewQueue, mergeReviewQueuePage, normalizeEmail, normalizePhone, overview, pendingInferenceSuggestions, peopleFacets, resolveMerge, reviewCounts, searchIndexRows, unmergeIdentity, updatePerson } from "./db.js";
import type { PeopleFilters } from "./db.js";
import { extractCapture } from "./capture/extract.js";
import { getProvider } from "./agent.js";
import {
  calculateRelationshipSignals,
  intelligenceStatus,
  intelligentAutofill,
  refreshEvidenceEmbeddings,
  refreshEvidenceIndex,
  refreshPersonEvidenceIndex,
  reviewInferenceSuggestion
} from "./intelligence/service.js";
import { generateRelationshipInsights } from "./intelligence/insights.js";
import { parsePersonPatch } from "../src/lib/contracts.js";
import {
  applyLinkedInPublicProfile,
  previewLinkedInPublicProfile
} from "./enrichment/linkedin.js";
import { listCities, listCountries, listStates } from "./geo/catalog.js";
import { normalizeHometownValue, normalizeLocationValue } from "./geo/normalize.js";
import {
  importLinkedInArchive,
  LINKEDIN_ARCHIVE_CONTENTS,
  previewLinkedInArchive
} from "./imports/linkedin-archive.js";
import {
  beginGmailAuthorization,
  beginTelegramAuthorization,
  configureGmail,
  configureTelegram,
  connectorPlatformStatus,
  disconnectGmail,
  disconnectTelegram,
  finishGmailAuthorization,
  gmailDefaults,
  importWhatsApp,
  mcpPlatformStatus,
  submitTelegramOtp,
  submitTelegramPassword,
  syncGmail,
  syncTelegram
} from "./platform/service.js";
import { setupStatus, updateOnboarding } from "./setup.js";
import {
  freshnessStatus,
  queueFreshnessNow,
  startFreshnessAgent,
  type FreshnessConnectorId
} from "./platform/freshness.js";

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const app = express();
const port = Number(process.env.PORT || 4174);
/** In production Express serves the SPA; in dev Vite owns the UI on :5173. */
function webAppUrl(pathname: string): string {
  const origin = (process.env.NETT_WEB_ORIGIN || "").replace(/\/$/, "")
    || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:5173");
  return origin ? `${origin}${pathname}` : pathname;
}
const activeConnectorSyncs = new Set<string>();
let peopleSearchCache: {
  revision: string;
  people: ReturnType<typeof searchIndexRows>;
  fuse: Fuse<ReturnType<typeof searchIndexRows>[number]>;
} | null = null;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const communicationUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });
const messagesUploadDir = path.resolve(process.cwd(), "data", "imports", "uploads");
mkdirSync(messagesUploadDir, { recursive: true });
const messagesUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, messagesUploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]+/g, "_")}`)
  }),
  limits: { fileSize: 800 * 1024 * 1024 }
});
app.use(express.json({ limit: "2mb" }));

function normalizePersonName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function parseSpreadsheet(file: { buffer: Buffer; originalname: string }) {
  const extension = path.extname(file.originalname).toLocaleLowerCase();
  if (extension === ".xlsx" || extension === ".xls") {
    const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: false });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new Error("The workbook does not contain a sheet");
    return XLSX.utils
      .sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], {
        defval: "",
        raw: false
      })
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, value == null ? "" : String(value)])
        )
      );
  }
  if (extension && extension !== ".csv") {
    throw new Error("Choose a .csv, .xlsx, or .xls spreadsheet");
  }
  return parse(file.buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  }) as Record<string, string>[];
}

app.get("/api/health", (_req, res) => res.json({ ok: true, local: true, database: "sqlite" }));
app.get("/api/bootstrap", (_req, res) => res.json({ ...overview(), setup: setupStatus() }));
app.get("/api/setup/status", (_req, res) => res.json(setupStatus()));
app.patch("/api/setup/onboarding", (req, res) => {
  try {
    updateOnboarding(req.body || {});
    res.json(setupStatus());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not update local setup" });
  }
});
app.get("/api/people", (_req, res) => res.json(getPeople()));

function peopleFiltersFromQuery(query: Record<string, unknown>): PeopleFilters {
  const requestedFilter = String(query.filter || "all");
  const recency = String(query.recency || "");
  const missing = String(query.missing || "");
  return {
    query: String(query.q || ""),
    filter: ["all", "strong", "due", "cold"].includes(requestedFilter)
      ? requestedFilter as "all" | "strong" | "due" | "cold"
      : "all",
    country: String(query.country || ""),
    industry: String(query.industry || ""),
    language: String(query.language || ""),
    relationship: String(query.relationship || ""),
    tag: String(query.tag || ""),
    recency: (["30d", "90d", "year", "never"].includes(recency) ? recency : "") as PeopleFilters["recency"],
    missing: ([
      "context", "hometown", "location", "industry", "company", "spike", "languages",
      "skills", "interests", "foods", "gender", "culture", "personality", "online_personality",
      "birthday", "relationship_strength", "relationship", "when_met", "where_met", "how_met",
      "institutions", "mutuals", "last_contact",
    ].includes(missing) ? missing : ""),
  };
}

app.get("/api/people/page", (req, res) => {
  res.json(getPeoplePage({
    ...peopleFiltersFromQuery(req.query as Record<string, unknown>),
    page: Number(req.query.page || 1),
    limit: Number(req.query.limit || 50)
  }));
});
app.get("/api/people/facets", (req, res) => {
  res.json(peopleFacets(peopleFiltersFromQuery(req.query as Record<string, unknown>)));
});
app.get("/api/people/:id", (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ error: "Person not found" });
  res.json(person);
});
app.get("/api/people/:id/communications", (req, res) => {
  if (!getPerson(req.params.id)) return res.status(404).json({ error: "Person not found" });
  const limit = Number(req.query.limit) || 50;
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  res.json(getPersonCommunications(req.params.id, { limit, cursor }));
});
app.get("/api/geo/countries", async (_req, res) => {
  try { res.json(await listCountries()); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not list countries" }); }
});
app.get("/api/geo/states", async (req, res) => {
  try { res.json(await listStates(String(req.query.country || ""))); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not list states" }); }
});
app.get("/api/geo/cities", async (req, res) => {
  try {
    res.json(await listCities(String(req.query.country || ""), typeof req.query.state === "string" ? req.query.state : undefined));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not list cities" });
  }
});
app.post("/api/geo/normalize", async (req, res) => {
  try {
    const label = await normalizeLocationValue(req.body?.text);
    res.json({ label });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not normalize place" });
  }
});
app.patch("/api/people/:id", async (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ error: "Person not found" });
  try {
    const body = { ...parsePersonPatch(req.body) } as Record<string, unknown>;
    if ("location" in body) body.location = await normalizeLocationValue(body.location);
    if ("hometown" in body) body.hometown = await normalizeHometownValue(body.hometown);
    const updated = updatePerson(req.params.id, body);
    refreshEvidenceIndex(req.params.id);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not update person" });
  }
});
app.post("/api/people/:id/insights", async (req, res) => {
  if (!getPerson(req.params.id)) return res.status(404).json({ error: "Person not found" });
  const controller = new AbortController();
  req.on("close", () => { if (!res.writableEnded) controller.abort(); });
  try {
    const result = await generateRelationshipInsights(req.params.id, controller.signal);
    if (res.writableEnded) return;
    res.json(result);
  } catch (error) {
    if (res.writableEnded) return;
    if (error instanceof Error && error.name === "AbortError") return;
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not generate insights" });
  }
});
app.post("/api/people/:id/autofill", async (req, res) => {
  // Two phases so the drawer can show evidence-backed suggestions immediately.
  // `generate=false` skips the local model and answers in milliseconds; the
  // model phase is a second request the client can abandon at any time.
  // The result object already carries `suggestions` — do not wrap it again.
  const generate = String(req.query.generate ?? "true") !== "false";
  const reindex = String(req.query.reindex ?? "false") === "true";
  const controller = new AbortController();
  req.on("close", () => { if (!res.writableEnded) controller.abort(); });
  try {
    const result = await intelligentAutofill(req.params.id, {
      generate,
      reindex,
      signal: controller.signal
    });
    if (res.writableEnded) return;
    res.json(result);
  } catch (error) {
    if (res.writableEnded) return;
    if (error instanceof Error && error.name === "AbortError") return;
    const message = error instanceof Error ? error.message : "Could not generate suggestions";
    res.status(message === "Person not found" ? 404 : 500).json({ error: message });
  }
});
app.post("/api/people/:id/evidence/refresh", async (req, res) => {
  if (!getPerson(req.params.id)) return res.status(404).json({ error: "Person not found" });
  const controller = new AbortController();
  req.on("close", () => { if (!res.writableEnded) controller.abort(); });
  try {
    const result = await refreshPersonEvidenceIndex(req.params.id, { signal: controller.signal });
    if (res.writableEnded) return;
    res.json(result);
  } catch (error) {
    if (res.writableEnded) return;
    if (error instanceof Error && error.name === "AbortError") return;
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not refresh evidence index" });
  }
});
app.post("/api/people/:id/enrichment/linkedin/preview", (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ error: "Person not found" });
  try {
    res.json(previewLinkedInPublicProfile({
      profileUrl: String(req.body.profileUrl || ""),
      publicText: String(req.body.publicText || "")
    }, person));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not inspect public profile text" });
  }
});
app.post("/api/people/:id/enrichment/linkedin/apply", async (req, res) => {
  try {
    res.json(await applyLinkedInPublicProfile(req.params.id, {
      profileUrl: String(req.body.profileUrl || ""),
      publicText: String(req.body.publicText || ""),
      acceptedFields: Array.isArray(req.body.acceptedFields)
        ? req.body.acceptedFields.map(String)
        : []
    }));
    refreshEvidenceIndex(req.params.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not apply public profile evidence";
    res.status(message === "Person not found" ? 404 : 400).json({ error: message });
  }
});
app.get("/api/people/:id/signals", (req, res) => {
  if (!getPerson(req.params.id)) return res.status(404).json({ error: "Person not found" });
  try { res.json(calculateRelationshipSignals(req.params.id)); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not calculate signals" }); }
});
app.post("/api/inference/suggestions/:id/review", (req, res) => {
  const decision = req.body.decision;
  if (decision !== "accepted" && decision !== "rejected") return res.status(400).json({ error: "Decision must be accepted or rejected" });
  try { res.json(reviewInferenceSuggestion(req.params.id, decision, Boolean(req.body.apply))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not review suggestion" }); }
});
app.get("/api/intelligence/status", async (_req, res) => {
  try { res.json(await intelligenceStatus()); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not inspect local intelligence" }); }
});
app.post("/api/intelligence/index", async (req, res) => {
  try {
    const index = refreshEvidenceIndex();
    const embeddings = req.body?.embed === false ? { embedded: 0 } : await refreshEvidenceEmbeddings(Number(req.body?.limit || 250));
    res.json({ ...index, ...embeddings });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not refresh the evidence index" });
  }
});

app.get("/api/search", (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) return res.json(getPeoplePage({ limit: 8 }).people);
  const revisionRow = db.prepare(`
    SELECT
      (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM people) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM nett_metadata) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(created_at), '') FROM memories) || '|' ||
      (SELECT COUNT(*) FROM contact_tags) AS revision
  `).get() as { revision: string };
  if (!peopleSearchCache || peopleSearchCache.revision !== revisionRow.revision) {
    const people = searchIndexRows();
    peopleSearchCache = {
      revision: revisionRow.revision,
      people,
      fuse: new Fuse(people, {
        threshold: 0.35,
        ignoreLocation: true,
        includeMatches: true,
        keys: ["name", "nickname", "company", "headline", "job_title", "industry", "institutions", "hometown", "location", "tags", "mutuals", "quick_memories", "notes", "interests"]
      })
    };
  }
  res.json(peopleSearchCache.fuse.search(query).slice(0, 12).map((result) => ({
    ...result.item,
    searchMatches: result.matches?.map((match) => match.key)
  })));
});

function parseMemory(text: string, people = searchIndexRows()) {
  const extraction = extractCapture(text);
  // Match on the name mentioned in the text when there is one; fall back to the
  // whole transcript. Matching on the transcript alone let unrelated words
  // score people highly.
  const personFuse = new Fuse(people, { threshold: 0.28, includeScore: true, keys: ["name", "nickname"] });
  const candidates = personFuse
    .search(extraction.nameHint || text)
    .slice(0, 4)
    .map((r) => ({
      id: (r.item as any).id,
      name: (r.item as any).name,
      company: (r.item as any).company,
      score: 1 - (r.score || 0),
    }));
  const valueOf = (field: string) => extraction.proposals.find((proposal) => proposal.field === field);
  const tagProposal = valueOf("tags");
  const tags = tagProposal?.values?.length
    ? tagProposal.values
    : (tagProposal?.value ? tagProposal.value.split(",").map((part) => part.trim()).filter(Boolean) : []);
  return {
    // The transcript is kept verbatim and separately from the editable memory.
    transcript: extraction.transcript,
    nameHint: extraction.nameHint,
    proposals: extraction.proposals,
    candidates,
    extracted: {
      memory: text.replace(/^remember (?:that )?/i, "").trim(),
      tags,
      followUpDate: valueOf("follow_up_date")?.value ?? null,
      relationship: valueOf("relationship")?.value ?? null,
      interests: tags.filter((t) => ["policy", "AI", "robotics", "health", "climate"].includes(t)),
    },
    ambiguous: candidates.length > 1 && candidates[0].score - candidates[1].score < 0.08,
  };
}

app.post("/api/memories/parse", (req, res) => {
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Memory text is required" });
  res.json(parseMemory(text));
});
app.post("/api/people/:id/memories", (req, res) => {
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Memory text is required" });
  if (!getPerson(req.params.id)) return res.status(404).json({ error: "Person not found" });
  const updated = addMemory(req.params.id, text, req.body.structured || {}, req.body.source || "manual");
  refreshEvidenceIndex(req.params.id);
  res.json(updated);
});

async function performConnectorSync(
  connectorId: string,
  options: { accountId?: string; maxBatches?: number; signal?: AbortSignal } = {},
) {
  if (connectorId === "gmail") {
    return syncGmail(String(options.accountId || "primary"));
  }
  if (connectorId === "telegram") {
    return syncTelegram(String(options.accountId || "primary"));
  }
  const connector = connectors.get(connectorId);
  if (!connector) throw new Error("Connector is not implemented yet");
  const maxBatches = connectorId === "messages" || connectorId === "whatsapp"
    ? Math.min(Math.max(Number(options.maxBatches) || 10, 1), 100)
    : undefined;
  const result = await connector.sync({ maxBatches, signal: options.signal });
  if (result.done !== false && connectorId !== "messages" && connectorId !== "whatsapp") {
    refreshEvidenceIndex();
  }
  return result;
}

app.get("/api/connectors", (_req, res) => res.json(connectorStates()));
app.post("/api/connectors/:id/sync", async (req, res) => {
  const connectorId = req.params.id;
  if (activeConnectorSyncs.has(connectorId)) {
    return res.status(409).json({ error: `${connectorId} is already syncing` });
  }
  activeConnectorSyncs.add(connectorId);
  const controller = new AbortController();
  req.once("aborted", () => controller.abort());
  try {
    const result = await performConnectorSync(connectorId, {
      accountId: String(req.body.accountId || "primary"),
      maxBatches: req.body.maxBatches,
      signal: controller.signal,
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connector sync failed";
    const status = message.includes("not implemented") ? 404 : 403;
    return res.status(status).json({ error: message });
  } finally {
    activeConnectorSyncs.delete(connectorId);
  }
});
app.get("/api/freshness", (_req, res) => res.json(freshnessStatus()));
app.post("/api/freshness/sync", (req, res) => {
  try {
    const connectorId = req.body?.connectorId
      ? String(req.body.connectorId) as FreshnessConnectorId
      : undefined;
    // Return immediately — never block HTTP on connector SQLite work.
    res.json(queueFreshnessNow(connectorId));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Freshness sync failed" });
  }
});
app.get("/api/review", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const merges = mergeReviewQueuePage(limit, offset);
  res.json({
    counts: reviewCounts(),
    merges: merges.items,
    mergesTotal: merges.total,
    suggestions: pendingInferenceSuggestions(80),
  });
});
app.get("/api/review/counts", (_req, res) => res.json(reviewCounts()));
app.get("/api/connectors/messages/status", (_req, res) => {
  try { res.json(messagesDatabaseStatus()); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not inspect Messages database" }); }
});
app.post("/api/connectors/messages/prepare", async (req, res) => {
  if (activeConnectorSyncs.has("messages")) {
    return res.status(409).json({ error: "Messages is already preparing or syncing" });
  }
  activeConnectorSyncs.add("messages");
  try {
    // Default preserves the ROWID cursor so "Pull new" only imports added messages.
    const prepared = await prepareLocalMessagesCopy(undefined, {
      resetCursor: req.body?.resetCursor === true || req.body?.resetCursor === "true"
    });
    res.json({
      messageCount: prepared.messageCount,
      bytes: prepared.bytes,
      preparedAt: prepared.preparedAt,
      cursorReset: prepared.cursorReset,
      syncCursor: prepared.syncCursor,
      message: prepared.cursorReset
        ? `Prepared ${prepared.messageCount.toLocaleString()} Messages records and reset the import cursor.`
        : `Updated the local Messages copy (${prepared.messageCount.toLocaleString()} records). New messages can be imported from ROWID ${prepared.syncCursor.lastRowId}.`
    });
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "Could not prepare a local Messages copy" });
  } finally {
    activeConnectorSyncs.delete("messages");
  }
});
app.post("/api/connectors/messages/import-db", messagesUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a chat.db or messages.db file" });
  if (activeConnectorSyncs.has("messages")) {
    try { unlinkSync(req.file.path); } catch { /* ignore temp cleanup */ }
    return res.status(409).json({ error: "Messages is already preparing or syncing" });
  }
  activeConnectorSyncs.add("messages");
  try {
    const prepared = await prepareLocalMessagesCopy(req.file.path, { resetCursor: true });
    res.json({
      messageCount: prepared.messageCount,
      bytes: prepared.bytes,
      preparedAt: prepared.preparedAt,
      cursorReset: prepared.cursorReset,
      message: `Validated ${prepared.messageCount.toLocaleString()} Messages records from ${req.file.originalname}. You can import them now.`
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Messages database import failed" });
  } finally {
    activeConnectorSyncs.delete("messages");
    if (req.file?.path && existsSync(req.file.path)) {
      try { unlinkSync(req.file.path); } catch { /* ignore temp cleanup */ }
    }
  }
});
app.get("/api/connectors/whatsapp/status", async (_req, res) => {
  try { res.json(await whatsappDesktopStatus()); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not inspect WhatsApp Desktop" }); }
});
app.post("/api/connectors/whatsapp/prepare", async (req, res) => {
  if (activeConnectorSyncs.has("whatsapp")) {
    return res.status(409).json({ error: "WhatsApp is already preparing or syncing" });
  }
  activeConnectorSyncs.add("whatsapp");
  const controller = new AbortController();
  req.once("aborted", () => controller.abort());
  try {
    const prepared = await prepareWhatsAppArchive({
      resetCursor: req.body?.resetCursor === true || req.body?.resetCursor === "true",
      signal: controller.signal
    });
    res.json(prepared);
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "Could not prepare the WhatsApp archive" });
  } finally {
    activeConnectorSyncs.delete("whatsapp");
  }
});
app.get("/api/platform/status", async (_req, res) => {
  try { res.json({ accounts: connectorPlatformStatus(), mcp: await mcpPlatformStatus() }); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Platform status failed" }); }
});
app.get("/api/platform/gmail/defaults", (_req, res) => {
  res.json(gmailDefaults());
});
app.post("/api/platform/gmail/configure", async (req, res) => {
  try { res.json(await configureGmail(req.body)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Gmail configuration failed" }); }
});
app.post("/api/platform/gmail/authorize", async (req, res) => {
  try { res.json(await beginGmailAuthorization(String(req.body.accountId || "primary"))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Gmail authorization failed" }); }
});
app.get("/api/platform/gmail/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!code || !state) return res.status(400).send("Gmail authorization did not return a code and state.");
  try {
    await finishGmailAuthorization(code, state);
    res.redirect(webAppUrl("/settings/connectors?gmail=connected"));
  } catch (error) {
    res.status(400).send(`Gmail authorization failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
});
app.delete("/api/platform/gmail/:accountId", async (req, res) => {
  try { await disconnectGmail(req.params.accountId); res.json({ ok: true }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Gmail disconnect failed" }); }
});
app.post("/api/platform/telegram/configure", async (req, res) => {
  try { res.json(await configureTelegram(req.body)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Telegram configuration failed" }); }
});
app.post("/api/platform/telegram/authorize", async (req, res) => {
  try { res.json(await beginTelegramAuthorization(String(req.body.accountId || "primary"), String(req.body.phone || ""))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Telegram authorization failed" }); }
});
app.post("/api/platform/telegram/otp", async (req, res) => {
  try { res.json(await submitTelegramOtp(String(req.body.accountId || "primary"), String(req.body.otp || ""))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Telegram verification failed" }); }
});
app.post("/api/platform/telegram/password", async (req, res) => {
  try { res.json(await submitTelegramPassword(String(req.body.accountId || "primary"), String(req.body.password || ""))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Telegram 2FA failed" }); }
});
app.delete("/api/platform/telegram/:accountId", async (req, res) => {
  try { await disconnectTelegram(req.params.accountId); res.json({ ok: true }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Telegram disconnect failed" }); }
});
app.post("/api/platform/whatsapp/import", communicationUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a WhatsApp .txt or .zip export" });
  if (!/\.(txt|zip)$/i.test(req.file.originalname)) return res.status(400).json({ error: "WhatsApp imports must be .txt or .zip files" });
  try {
    const result = await importWhatsApp({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      accountId: String(req.body.accountId || "personal"),
      conversationId: req.body.conversationId ? String(req.body.conversationId) : undefined,
      conversationTitle: req.body.conversationTitle ? String(req.body.conversationTitle) : undefined,
      selfNames: listify(req.body.selfNames),
      selfPhones: listify(req.body.selfPhones),
      dateOrder: ["DMY", "MDY", "YMD"].includes(req.body.dateOrder) ? req.body.dateOrder : undefined
    });
    refreshEvidenceIndex();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "WhatsApp import failed" });
  }
});
app.get("/api/merges", (_req, res) => res.json(mergeReviewQueue()));
app.post("/api/merges/:identityId/resolve", (req, res) => {
  try { res.json(resolveMerge(req.params.identityId, req.body.personId, Boolean(req.body.createNew))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not resolve match" }); }
});
app.post("/api/identities/:identityId/unmerge", (req, res) => {
  try { res.json(unmergeIdentity(req.params.identityId)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not separate identity" }); }
});

const schemaFields = [
  "name", "hometown", "location", "industry", "company", "spike", "languages", "skills",
  "interests", "foods", "gender", "culture", "personality", "online_personality", "birthday",
  "relationship_strength", "relationship", "when_met", "where_met", "how_met", "institutions",
  "mutuals", "last_contact", "tags", "notes", "quick_memories", "follow_up_date", "priority",
  "warmth", "intro_potential", "source_confidence", "linkedin_url", "headline", "job_title",
];
const importListFields = new Set([
  "hometown", "languages", "skills", "interests", "foods", "institutions", "mutuals",
  "online_personality",
]);
const importDateFields = new Set(["birthday", "follow_up_date", "last_contact"]);
const importHeaderAliases: Record<string, string> = {
  e_mail: "email",
  email_address: "email",
  email_addresses: "emails",
  mobile: "phone",
  mobile_phone: "phone",
  phone_number: "phone",
  phone_numbers: "phones",
  organization: "company",
  organisation: "company",
  title: "job_title",
  linkedin: "linkedin_url",
  linkedin_profile: "linkedin_url",
  linkedin_url_: "linkedin_url"
};

function normalizeSpreadsheetDate(value: string): string {
  const text = value.trim();
  if (!text || /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function canonicalSpreadsheetRow(row: Record<string, unknown>) {
  const data: Record<string, string> = {};
  for (const [header, rawValue] of Object.entries(row)) {
    const normalizedHeader = header.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
    const key = importHeaderAliases[normalizedHeader] || normalizedHeader;
    const value = rawValue == null ? "" : String(rawValue).trim();
    if (value && !data[key]) data[key] = value;
  }
  if (!data.name) data.name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  for (const field of importDateFields) {
    if (data[field]) data[field] = normalizeSpreadsheetDate(data[field]);
  }
  return data;
}

function blankImportValue(value: unknown) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function insertImportedTags(personId: string, tags: string[]) {
  for (const label of tags) {
    const cleanLabel = label.trim();
    if (!cleanLabel) continue;
    const existing = db.prepare("SELECT id FROM tags WHERE lower(name)=lower(?)").get(cleanLabel) as { id: string } | undefined;
    const tagId = existing?.id || randomUUID();
    if (!existing) db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(tagId, cleanLabel);
    db.prepare(`
      INSERT OR IGNORE INTO contact_tags (person_id, tag_id, source) VALUES (?, ?, 'csv')
    `).run(personId, tagId);
  }
}

function insertImportedContactMethods(
  personId: string,
  sourceIdentityId: string,
  emails: string[],
  phones: string[]
) {
  const values = [
    ...emails.map((value) => ({ kind: "email", value, normalized: normalizeEmail(value) })),
    ...phones.map((value) => ({ kind: "phone", value, normalized: normalizePhone(value) }))
  ];
  for (const contact of values) {
    if (!contact.normalized) continue;
    const exists = db.prepare(`
      SELECT 1 FROM contact_methods
      WHERE person_id=? AND kind=? AND normalized_value=?
    `).get(personId, contact.kind, contact.normalized);
    if (exists) continue;
    db.prepare(`
      INSERT INTO contact_methods
        (id, person_id, kind, value, normalized_value, label, source_identity_id, is_primary)
      VALUES (?, ?, ?, ?, ?, 'spreadsheet', ?, 0)
    `).run(randomUUID(), personId, contact.kind, contact.value, contact.normalized, sourceIdentityId);
  }
}

app.get("/api/import/linkedin/contents", (_req, res) => {
  res.json(LINKEDIN_ARCHIVE_CONTENTS);
});

app.post("/api/import/linkedin/preview", communicationUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a LinkedIn archive zip or Connections.csv" });
  try {
    res.json(previewLinkedInArchive({
      filename: req.file.originalname,
      bytes: new Uint8Array(req.file.buffer)
    }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not read that LinkedIn archive" });
  }
});

app.post("/api/import/linkedin", communicationUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a LinkedIn archive zip or Connections.csv" });
  try {
    const summary = importLinkedInArchive({
      filename: req.file.originalname,
      bytes: new Uint8Array(req.file.buffer)
    });
    res.json(summary);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not import that LinkedIn archive" });
  }
});

app.post("/api/import/csv", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a CSV or Excel spreadsheet" });
  let importId: string | undefined;
  try {
    const rows = parseSpreadsheet(req.file);
    if (!rows.length) return res.status(400).json({ error: "The spreadsheet does not contain any data rows" });
    if (rows.length > 25_000) return res.status(400).json({ error: "Import at most 25,000 rows at a time" });
    const fileHash = createHash("sha256").update(req.file.buffer).digest("hex");
    const prior = db.prepare(`
      SELECT id, summary_json FROM imports WHERE file_hash=? AND status='committed'
    `).get(fileHash) as { id: string; summary_json: string } | undefined;
    if (prior) {
      return res.json({ importId: prior.id, duplicate: true, ...JSON.parse(prior.summary_json) });
    }

    importId = randomUUID();
    db.prepare(`
      INSERT INTO imports (id, filename, file_hash, row_count, status, created_at)
      VALUES (?, ?, ?, ?, 'processing', datetime('now'))
    `).run(importId, req.file.originalname, fileHash, rows.length);

    const preparedRows = rows.map((raw, index) => {
      const data = canonicalSpreadsheetRow(raw);
      const emails = listify(data.email || data.emails);
      const phones = listify(data.phone || data.phones);
      const normalizedName = normalizePersonName(data.name || "");
      return {
        rowNumber: index + 2,
        raw,
        data,
        emails,
        phones,
        normalizedName,
        contentHash: createHash("sha256").update(JSON.stringify(data)).digest("hex")
      };
    });
    const namesInFile = new Map<string, number>();
    for (const row of preparedRows) {
      if (row.normalizedName) namesInFile.set(row.normalizedName, (namesInFile.get(row.normalizedName) || 0) + 1);
    }

    const existingPeople = getPeople().map((person) => ({
      id: String(person.id),
      name: String(person.name || ""),
      nickname: person.nickname ? String(person.nickname) : undefined
    }));
    const byExactName = new Map<string, string[]>();
    const addExactName = (value: string, personId: string) => {
      const key = normalizePersonName(value);
      if (!key) return;
      const ids = byExactName.get(key) ?? [];
      if (!ids.includes(personId)) ids.push(personId);
      byExactName.set(key, ids);
    };
    for (const person of existingPeople) {
      addExactName(person.name || "", person.id);
      addExactName(person.nickname || "", person.id);
    }
    const nameFuse = new Fuse(existingPeople, { threshold: 0.28, includeScore: true, keys: ["name", "nickname"] });
    let merged = 0, created = 0, review = 0, invalid = 0, conflicts = 0;
    const results: any[] = [];
    const tx = db.transaction(() => {
      preparedRows.forEach((prepared) => {
      const { data: lowered, emails, phones, normalizedName, rowNumber, contentHash } = prepared;
      const hasIdentity = Boolean(normalizedName || emails.length || phones.length);
      if (!hasIdentity) {
        invalid++;
        db.prepare(`
          INSERT INTO imported_rows
            (id, import_id, row_number, raw_json, content_hash, match_method, confidence, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'missing-identity', 0, 'invalid', datetime('now'))
        `).run(randomUUID(), importId, rowNumber, JSON.stringify(prepared.raw), contentHash);
        results.push({ row: rowNumber, name: "", status: "invalid", error: "A name, email, or phone is required" });
        return;
      }

      const exact = findExactPerson(emails, phones);
      const fuzzy = nameFuse.search(lowered.name || "").slice(0, 3);
      const exactNameIds = normalizedName ? byExactName.get(normalizedName) ?? [] : [];
      const duplicateNameInFile = normalizedName ? (namesInFile.get(normalizedName) || 0) > 1 : false;
      const exactNameId = exactNameIds.length === 1 && !duplicateNameInFile ? exactNameIds[0] : undefined;
      const ambiguousExactName = exactNameIds.length > 1 || duplicateNameInFile;
      let personId = exact?.person_id || exactNameId || null;
      let status = "merged";
      let method = exact
        ? "exact-contact-method"
        : exactNameId
          ? "exact-name"
          : null;
      let confidence = exact || exactNameId ? 1 : fuzzy[0] ? 1 - (fuzzy[0].score || 0) : 0;
      if (!personId && (ambiguousExactName || !normalizedName || (fuzzy[0] && confidence >= 0.78))) {
        status = "review";
        method = ambiguousExactName
          ? duplicateNameInFile ? "duplicate-name-in-file" : "ambiguous-exact-name"
          : !normalizedName ? "contact-method-review" : "fuzzy-name-suggestion";
        review++;
      } else if (!personId) {
        personId = createPerson(lowered.name, "csv");
        status = "created"; method = "new-person"; created++;
      } else merged++;

      const addresses = [
        ...emails.map((value) => ({ kind: "email", value, normalized: normalizeEmail(value) })),
        ...phones.map((value) => ({ kind: "phone", value, normalized: normalizePhone(value) }))
      ];
      const raw = { ...lowered, addresses };
      const rawJson = JSON.stringify(raw);
      const identityId = randomUUID();
      db.prepare(`
        INSERT INTO source_identities
          (id, connector_id, external_id, display_name, raw_json, person_id, linked_by, confidence, created_at, updated_at)
        VALUES (?, 'csv', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        identityId,
        `${importId}:${rowNumber}`,
        lowered.name || emails[0] || phones[0] || `Row ${rowNumber}`,
        rawJson,
        personId,
        status === "review" ? "unlinked" : method,
        confidence
      );
      db.prepare(`
        INSERT INTO source_records
          (id, connector_id, external_id, source_identity_id, person_id, entity_type, raw_json, captured_at)
        VALUES (?, 'csv', ?, ?, ?, 'spreadsheet-row', ?, datetime('now'))
      `).run(randomUUID(), `${importId}:${rowNumber}`, identityId, personId, rawJson);

      if (status === "review") {
        const candidates = new Map<string, { id: string; name: string; confidence: number; reason: string }>();
        for (const candidateId of exactNameIds) {
          const candidate = existingPeople.find((person) => person.id === candidateId);
          if (candidate) candidates.set(candidate.id, { id: candidate.id, name: candidate.name, confidence: 1, reason: "ambiguous-exact-name" });
        }
        for (const candidate of fuzzy) {
          if (!candidates.has(candidate.item.id)) {
            candidates.set(candidate.item.id, {
              id: candidate.item.id,
              name: candidate.item.name,
              confidence: 1 - (candidate.score || 0),
              reason: "fuzzy-name"
            });
          }
        }
        for (const candidate of [...candidates.values()].slice(0, 3)) {
          db.prepare(`
            INSERT INTO merge_suggestions
              (id, source_identity_id, candidate_person_id, reason, confidence, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
          `).run(randomUUID(), identityId, candidate.id, candidate.reason, candidate.confidence);
        }
        db.prepare(`
          INSERT INTO imported_rows
            (id, import_id, row_number, raw_json, source_identity_id, content_hash, matched_person_id, match_method, confidence, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'review', datetime('now'))
        `).run(randomUUID(), importId, rowNumber, rawJson, identityId, contentHash, method, confidence);
        results.push({ row: rowNumber, name: lowered.name, status, candidates: [...candidates.values()].slice(0, 3) });
        return;
      }

      const current = getPerson(personId!) as Record<string, any>;
      const update: Record<string, unknown> = {};
      const previousValues: Record<string, unknown> = {};
      const rowConflicts: string[] = [];
      for (const field of schemaFields) {
        if (field === "name" || field === "tags" || lowered[field] === undefined || lowered[field] === "") continue;
        const importedValue = importListFields.has(field) ? listify(lowered[field]) : lowered[field];
        const currentValue = current[field];
        if (status === "created" || blankImportValue(currentValue)) {
          previousValues[field] = currentValue;
          update[field] = importedValue;
        } else if (importListFields.has(field)) {
          const combined = [...new Set([...listify(currentValue), ...listify(importedValue)])];
          if (combined.length !== listify(currentValue).length) {
            previousValues[field] = currentValue;
            update[field] = combined;
          }
        } else if (String(currentValue).trim() !== String(importedValue).trim()) {
          rowConflicts.push(field);
        }
      }
      if (Object.keys(update).length) updatePerson(personId!, update, "csv");
      if (lowered.tags) insertImportedTags(personId!, listify(lowered.tags));
      insertImportedContactMethods(personId!, identityId, emails, phones);
      if (lowered.quick_memories) addMemory(personId!, lowered.quick_memories, { imported: true, importId }, "csv");
      conflicts += rowConflicts.length;
      db.prepare(`
        INSERT INTO imported_rows
          (id, import_id, row_number, raw_json, source_identity_id, content_hash, matched_person_id, match_method, confidence, status, previous_values_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        randomUUID(),
        importId,
        rowNumber,
        rawJson,
        identityId,
        contentHash,
        personId,
        method,
        confidence,
        status,
        JSON.stringify(previousValues)
      );
      results.push({ row: rowNumber, name: lowered.name, status, personId, method, confidence, conflicts: rowConflicts });
      });
      const summary = { rows: rows.length, merged, created, review, invalid, conflicts, results };
      db.prepare(`
        UPDATE imports
        SET status='committed', summary_json=?, completed_at=datetime('now')
        WHERE id=?
      `).run(JSON.stringify(summary), importId);
    });
    tx();
    const summary = { rows: rows.length, merged, created, review, invalid, conflicts, results };
    refreshEvidenceIndex();
    res.json({ importId, duplicate: false, ...summary });
  } catch (error) {
    if (importId) {
      db.prepare(`
        UPDATE imports SET status='failed', summary_json=?, completed_at=datetime('now') WHERE id=?
      `).run(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), importId);
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Spreadsheet import failed" });
  }
});

app.post("/api/agent/query", async (req, res) => {
  const query = String(req.body.query || "").trim();
  if (!query) return res.status(400).json({ error: "Ask a question about your network" });
  try { res.json(await getProvider().answer(query)); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Insight query failed" }); }
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(process.cwd(), "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected local server error" });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Nett local server running at http://127.0.0.1:${port}`);
  startFreshnessAgent({
    isBusy: (id) => activeConnectorSyncs.has(id),
    ready: async (id) => {
      if (id === "messages") {
        try {
          const status = messagesDatabaseStatus();
          return Boolean(status.readable || status.usingLocalCopy);
        } catch {
          return false;
        }
      }
      if (id === "whatsapp") {
        try {
          const status = await whatsappDesktopStatus();
          return Boolean(status.readable || status.archiveReadable);
        } catch {
          return false;
        }
      }
      if (id === "gmail") {
        const accounts = connectorPlatformStatus();
        return accounts.some((account) => account.connectorId === "gmail" && account.authState === "authenticated");
      }
      return true;
    },
    sync: async (connectorId, signal) => {
      if (activeConnectorSyncs.has(connectorId)) {
        throw new Error(`${connectorId} is already syncing`);
      }
      activeConnectorSyncs.add(connectorId);
      try {
        // One small batch per idle tick — large syncs block the Express event loop
        // (better-sqlite3 is synchronous) and freeze the UI on /api/bootstrap.
        const maxBatches = connectorId === "messages" || connectorId === "whatsapp" ? 1 : undefined;
        const result = await performConnectorSync(connectorId, { maxBatches, signal });
        return { message: typeof result?.message === "string" ? result.message : "Synced" };
      } finally {
        activeConnectorSyncs.delete(connectorId);
      }
    },
  });
});
