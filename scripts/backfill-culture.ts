// One-shot maintenance: fill empty culture fields from the name / surname
// tables in server/intelligence/traits.ts. Existing values are never touched.
// Every fill is recorded in field_provenance under "name-inference".
//
// Run with: npx tsx scripts/backfill-culture.ts [--dry-run]

import { db, updatePerson } from "../server/db.js";
import { suggestCultureFromName } from "../server/intelligence/traits.js";

const dryRun = process.argv.includes("--dry-run");

const people = db.prepare(`
  SELECT p.id, p.preferred_name, p.first_name, p.last_name
  FROM people p
  JOIN nett_metadata m ON m.person_id = p.id
  WHERE TRIM(COALESCE(m.culture, '')) = ''
`).all() as {
  id: string;
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
}[];

const counts = new Map<string, number>();
let filled = 0;
let unknown = 0;

for (const person of people) {
  const suggestion = suggestCultureFromName({
    preferred_name: person.preferred_name ?? undefined,
    first_name: person.first_name ?? undefined,
    last_name: person.last_name ?? undefined,
    culture: "",
  });
  if (!suggestion) {
    unknown += 1;
    continue;
  }
  const value = String(suggestion.value);
  counts.set(value, (counts.get(value) || 0) + 1);
  filled += 1;
  if (dryRun) console.log(`${value.padEnd(28)} ${person.preferred_name}`);
  else updatePerson(person.id, { culture: value }, "name-inference");
}

console.log(`${dryRun ? "[dry run] " : ""}people without culture: ${people.length}`);
console.log(`filled: ${filled}`);
console.log(`no confident match (left empty): ${unknown}`);
console.log(
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `  ${n}\t${label}`)
    .join("\n"),
);
