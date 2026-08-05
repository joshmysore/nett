// Second-pass maintenance: classify remaining empty gender fields with the
// local Ollama model (loopback only — nothing leaves the machine). The model
// only ever sees the contact's name. Answers other than a confident
// male/female (business names, unisex nicknames, non-names) leave the field
// empty. Writes go through updatePerson, so values are normalised and every
// fill is recorded in field_provenance under "name-inference".
//
// Run with: npx tsx scripts/backfill-gender-llm.ts [--dry-run] [--limit N]

import { db, updatePerson } from "../server/db.js";

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const OLLAMA = "http://127.0.0.1:11434";
const MODEL = process.env.NETT_OLLAMA_MODEL || process.env.NETT_GENDER_MODEL || "qwen3:14b";
const BATCH = 12;

type Row = { id: string; name: string };

const people = (db.prepare(`
  SELECT p.id, p.preferred_name AS name
  FROM people p
  JOIN nett_metadata m ON m.person_id = p.id
  WHERE TRIM(COALESCE(m.gender, '')) = ''
  ORDER BY p.preferred_name
`).all() as Row[]).slice(0, limit === Infinity ? undefined : limit);

const system = [
  "You classify contact names by the gender most commonly associated with the given name, across all languages and cultures (Indian, Turkish, Spanish, Slavic, East Asian, African, and others).",
  "Judge only the given name, never the surname.",
  "Answer \"unknown\" when the entry is not a personal given name (a business, a description like 'Photographer' with no given name, a relationship word), when the name is genuinely unisex, or when you are not confident.",
].join(" ");

// Enforced response schema — Ollama structured outputs keep the shape stable.
const format = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          gender: { type: "string", enum: ["male", "female", "unknown"] },
        },
        required: ["name", "gender"],
      },
    },
  },
  required: ["results"],
};

async function classify(batch: Row[]): Promise<Map<string, string>> {
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Classify each name: ${JSON.stringify(batch.map((row) => row.name))}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}`);
  const payload = await response.json() as { message?: { content?: string } };
  let parsed: { results?: { name?: unknown; gender?: unknown }[] };
  try {
    parsed = JSON.parse(payload.message?.content ?? "");
  } catch {
    return new Map();
  }
  const out = new Map<string, string>();
  for (const item of parsed.results ?? []) {
    const name = String(item?.name ?? "");
    const gender = String(item?.gender ?? "").toLowerCase();
    if ((gender === "male" || gender === "female") && name) out.set(name, gender);
  }
  return out;
}

let male = 0;
let female = 0;
let unknown = 0;
let failed = 0;

for (let index = 0; index < people.length; index += BATCH) {
  const batch = people.slice(index, index + BATCH);
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
    const gender = answers.get(row.name);
    if (gender !== "male" && gender !== "female") {
      unknown += 1;
      continue;
    }
    if (gender === "male") male += 1;
    else female += 1;
    if (dryRun) console.log(`${gender.padEnd(7)} ${row.name}`);
    else updatePerson(row.id, { gender }, "name-inference");
  }
  if (!dryRun && index % (BATCH * 10) === 0) {
    console.log(`progress: ${Math.min(index + BATCH, people.length)}/${people.length}`);
  }
}

console.log(`${dryRun ? "[dry run] " : ""}candidates: ${people.length}`);
console.log(`male: ${male}, female: ${female}, left unknown: ${unknown}, failed: ${failed}`);
