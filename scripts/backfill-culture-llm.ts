// Classify culture from names with a strong local Ollama model (loopback only).
// Family names are the primary signal; company / location strings are weak hints
// (e.g. "Ukraine Heritage"). Mixed heritage may receive several labels.
//
// Run with:
//   npx tsx scripts/backfill-culture-llm.ts [--dry-run] [--limit N] [--redo-inference]
//
// --redo-inference reclassifies rows whose latest culture provenance is
// name-inference (fixes earlier weak-model mistakes without touching owner edits).

import { db, updatePerson } from "../server/db.js";
import { CULTURE_VOCAB, normalizeCultureValue } from "../server/intelligence/culture.js";

const dryRun = process.argv.includes("--dry-run");
const redoInference = process.argv.includes("--redo-inference");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const OLLAMA = "http://127.0.0.1:11434";
const MODEL = process.env.NETT_OLLAMA_MODEL || process.env.NETT_CULTURE_MODEL || "qwen3:14b";
const BATCH = 6;

type Row = {
  id: string;
  name: string;
  company: string | null;
  location: string | null;
  culture: string | null;
};

const people = (redoInference
  ? db.prepare(`
      SELECT p.id, p.preferred_name AS name, m.company, m.location, m.culture
      FROM people p
      JOIN nett_metadata m ON m.person_id = p.id
      WHERE TRIM(COALESCE(m.culture, '')) != ''
        AND (
          SELECT fp.connector_id FROM field_provenance fp
          WHERE fp.person_id = p.id AND fp.field_name = 'culture'
          ORDER BY fp.observed_at DESC, fp.rowid DESC
          LIMIT 1
        ) = 'name-inference'
      ORDER BY p.preferred_name
    `)
  : db.prepare(`
      SELECT p.id, p.preferred_name AS name, m.company, m.location, m.culture
      FROM people p
      JOIN nett_metadata m ON m.person_id = p.id
      WHERE TRIM(COALESCE(m.culture, '')) = ''
      ORDER BY p.preferred_name
    `)
).all() as Row[];

const queue = people.slice(0, limit === Infinity ? undefined : limit);

const vocabList = CULTURE_VOCAB.join(", ");

const system = [
  "You classify contact names by cultural / linguistic origin suggested by the name.",
  "Family names (surnames) are the strongest signal. Given names are secondary.",
  "Optional company or location text may contain heritage hints (e.g. \"Ukraine Heritage\") — use those when they clearly name an origin.",
  `Use labels ONLY from this vocabulary: ${vocabList}.`,
  "Mixed heritage is common — return EVERY clear label, up to 6, joined with \" / \" (e.g. \"Chinese / Korean / Anglo\", \"Ukrainian / Jewish / Hebrew\").",
  "Prefer specific surname tells (Maydanich / -ich → Ukrainian or Slavic; Zhang → Chinese; Patel → South Asian; García → Hispanic / Latino; Kim → Korean; O'Brien → Irish; Birenbaum → Jewish / Hebrew).",
  "Do not invent unrelated labels. Do not guess Hispanic / Latino or Punjabi from a Slavic or Ukrainian surname.",
  "Answer culture \"unknown\" for businesses, places, nicknames-only, or when not confident.",
  "Never invent religion, politics, caste, or skin colour as race. This is naming-pattern context, not identity.",
  "/no_think",
].join(" ");

const format = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          culture: { type: "string" },
        },
        required: ["name", "culture"],
      },
    },
  },
  required: ["results"],
};

function hintFor(row: Row): string {
  const bits = [row.company, row.location].map((value) => String(value ?? "").trim()).filter(Boolean);
  return bits.length ? ` hints=${JSON.stringify(bits.join(" · "))}` : "";
}

async function classify(batch: Row[]): Promise<Map<string, string>> {
  const payloadNames = batch.map((row) => ({
    name: row.name,
    company: row.company || undefined,
    location: row.location || undefined,
  }));
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format,
      options: { temperature: 0, num_ctx: 4096 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Classify each contact: ${JSON.stringify(payloadNames)}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}`);
  const payload = await response.json() as { message?: { content?: string } };
  let parsed: { results?: { name?: unknown; culture?: unknown }[] };
  try {
    parsed = JSON.parse(payload.message?.content ?? "");
  } catch {
    return new Map();
  }
  const out = new Map<string, string>();
  for (const item of parsed.results ?? []) {
    const name = String(item?.name ?? "");
    const culture = normalizeCultureValue(item?.culture);
    if (name && culture && culture.toLowerCase() !== "unknown") out.set(name, culture);
  }
  return out;
}

const counts = new Map<string, number>();
let filled = 0;
let unchanged = 0;
let unknown = 0;
let failed = 0;

console.log(`model: ${MODEL}`);
console.log(`mode: ${redoInference ? "redo name-inference" : "empty only"}`);
console.log(`candidates: ${queue.length}`);

for (let index = 0; index < queue.length; index += BATCH) {
  const batch = queue.slice(index, index + BATCH);
  let answers = new Map<string, string>();
  try {
    answers = await classify(batch);
    if (!answers.size && batch.length) answers = await classify(batch);
  } catch (error) {
    failed += batch.length;
    console.error(`batch ${index / BATCH}: ${error instanceof Error ? error.message : error}`);
    continue;
  }
  for (const row of batch) {
    const culture = answers.get(row.name);
    if (!culture) {
      unknown += 1;
      if (dryRun) console.log(`UNKNOWN${hintFor(row)}  ${row.name}`);
      continue;
    }
    counts.set(culture, (counts.get(culture) || 0) + 1);
    if (normalizeCultureValue(row.culture) === culture) {
      unchanged += 1;
      continue;
    }
    filled += 1;
    if (dryRun) {
      console.log(`${culture.padEnd(40)} ${row.name}${hintFor(row)}${row.culture ? `  was=${JSON.stringify(row.culture)}` : ""}`);
    } else {
      updatePerson(row.id, { culture }, "name-inference");
    }
  }
  if (!dryRun && index % (BATCH * 5) === 0) {
    console.log(`progress: ${Math.min(index + BATCH, queue.length)}/${queue.length}`);
  }
}

console.log(`${dryRun ? "[dry run] " : ""}changed: ${filled}, unchanged: ${unchanged}, unknown: ${unknown}, failed: ${failed}`);
console.log(
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([label, n]) => `  ${n}\t${label}`)
    .join("\n"),
);
