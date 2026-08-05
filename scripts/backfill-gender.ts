// One-shot maintenance: fill empty gender fields from the given-name tables in
// server/intelligence/traits.ts. Writes go through updatePerson so every fill
// is normalised to male/female and recorded in field_provenance with the
// "name-inference" source. Existing values are never touched.
//
// Run with: npx tsx scripts/backfill-gender.ts [--dry-run]

import { db, updatePerson } from "../server/db.js";
import { suggestGenderFromName } from "../server/intelligence/traits.js";

const dryRun = process.argv.includes("--dry-run");

const people = db.prepare(`
  SELECT p.id, p.preferred_name, p.first_name
  FROM people p
  JOIN nett_metadata m ON m.person_id = p.id
  WHERE TRIM(COALESCE(m.gender, '')) = ''
`).all() as { id: string; preferred_name: string | null; first_name: string | null }[];

let male = 0;
let female = 0;
let unknown = 0;

for (const person of people) {
  const suggestion = suggestGenderFromName({
    preferred_name: person.preferred_name ?? undefined,
    first_name: person.first_name ?? undefined,
    gender: "",
  });
  if (!suggestion) {
    unknown += 1;
    continue;
  }
  const value = String(suggestion.value);
  if (value === "male") male += 1;
  else if (value === "female") female += 1;
  else continue;
  if (!dryRun) updatePerson(person.id, { gender: value }, "name-inference");
}

console.log(`${dryRun ? "[dry run] " : ""}people without gender: ${people.length}`);
console.log(`filled male: ${male}`);
console.log(`filled female: ${female}`);
console.log(`no confident match (left empty): ${unknown}`);
