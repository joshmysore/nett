#!/usr/bin/env node
/**
 * Ask eval harness. Copies the real database (never writes it) and scores
 * golden questions for recall, citations, latency, and protected-trait leakage.
 *
 *   node --import tsx scripts/ask-eval.mjs
 *   node --import tsx scripts/ask-eval.mjs --out docs/audits/ask-eval-after.json
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDb = process.env.NETT_ASK_EVAL_SOURCE || path.join(root, "data/nett.db");
const destDb = process.env.NETT_ASK_EVAL_DB || path.join(tmpdir(), "nett-ask-eval.db");
const outArg = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : path.join(root, "docs/audits/ask-eval-before.json");

if (!existsSync(sourceDb)) {
  console.error(`No source database at ${sourceDb}`);
  process.exit(1);
}
if (path.resolve(destDb) === path.resolve(sourceDb)) {
  console.error("Refusing to point NETT_DB_PATH at the live database");
  process.exit(1);
}

cpSync(sourceDb, destDb);
for (const suffix of ["-wal", "-shm"]) {
  const extra = `${sourceDb}${suffix}`;
  if (existsSync(extra)) cpSync(extra, `${destDb}${suffix}`);
}
process.env.NETT_DB_PATH = destDb;

const { answerRelationshipQuestion } = await import("../server/intelligence/service.ts");

const PROTECTED = /\b(ethnicity|ethnic|race|racial|religion|religious|politic|sexuality|sexual orientation|gay|lesbian|health condition|diagnos)/i;

/** Questions in the user's voice. expectedName is optional recall signal. */
const GOLDEN = [
  { q: "Who do I know in Paris who like spicy food?", expectAny: true },
  { q: "Who do I know in Paris?", expectAny: true },
  { q: "What do I know about Sam Weil?", expectName: "Sam Weil" },
  { q: "Who have I emailed about legal tech?" },
  { q: "What did Ada and I talk about last week?", expectName: "Ada" },
  { q: "Who might be interested in legal tech?" },
  { q: "What do I know about the people I contacted most recently?", expectAny: true },
  { q: "Who likes Spanish red wine?", expectName: "Sam Weil" },
  { q: "Who works in climate finance?" },
  { q: "Who speaks Portuguese?" },
  { q: "Who do I know in Philadelphia?" },
  { q: "Who have I texted about food?" },
  { q: "Who did I meet in Lisbon?" },
  { q: "Who grew up in Porto?" },
  { q: "Who should I follow up with?" },
  { q: "Who is at Harvard?" },
  { q: "What do I know about Kendra?" },
  { q: "Who lives in Chile?" },
  { q: "Who likes hiking?" },
  { q: "Who have I talked to on WhatsApp recently?" },
  { q: "Who works on robotics?" },
  { q: "Who do I know in New York?" },
  { q: "What foods does anyone like?" },
  { q: "Who might introduce me to someone in climate?" },
  { q: "Who have I not recorded a hometown for?" },
];

function citationIsSubstring(citation) {
  const value = String(citation?.value || "").trim();
  if (!value) return false;
  return value.length >= 2;
}

const rows = [];
for (const item of GOLDEN) {
  const started = performance.now();
  let result = { answer: "", citations: [], provider: "error" };
  let error = null;
  try {
    result = await answerRelationshipQuestion(item.q);
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  const ms = Math.round(performance.now() - started);
  const names = [...new Set((result.citations || []).map((c) => String(c.label || "")))];
  const recalled = item.expectName
    ? names.some((name) => name.toLowerCase().includes(item.expectName.toLowerCase()))
      || String(result.answer || "").toLowerCase().includes(item.expectName.toLowerCase())
    : item.expectAny
      ? names.length > 0 || /•/.test(result.answer || "")
      : null;
  const cited = (result.citations || []).some(citationIsSubstring);
  const leaked = PROTECTED.test(result.answer || "");
  rows.push({
    question: item.q,
    ms,
    provider: result.provider,
    people: names,
    recalled,
    cited,
    leaked,
    error,
    answerChars: String(result.answer || "").length,
    citationCount: (result.citations || []).length,
  });
  console.log(`${ms}ms  ${recalled === false ? "MISS" : "ok  "}  ${result.provider}  ${item.q}`);
}

const latencies = rows.map((row) => row.ms).sort((a, b) => a - b);
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * p))] ?? 0;
const scored = rows.filter((row) => row.recalled !== null);
const report = {
  generatedAt: new Date().toISOString(),
  database: destDb,
  source: sourceDb,
  questions: rows.length,
  recall: {
    scored: scored.length,
    hit: scored.filter((row) => row.recalled).length,
  },
  cited: rows.filter((row) => row.cited).length,
  leaked: rows.filter((row) => row.leaked).length,
  errors: rows.filter((row) => row.error).length,
  latency: {
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: latencies.at(-1) ?? 0,
  },
  providers: Object.fromEntries(
    [...new Set(rows.map((row) => row.provider))].map((provider) => [
      provider,
      rows.filter((row) => row.provider === provider).length,
    ]),
  ),
  rows,
};

mkdirSync(path.dirname(outArg), { recursive: true });
writeFileSync(outArg, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nWrote ${outArg}`);
console.log(`recall ${report.recall.hit}/${report.recall.scored}  cited ${report.cited}/${rows.length}  p50 ${report.latency.p50}ms  p95 ${report.latency.p95}ms`);
