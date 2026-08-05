// One-shot maintenance: rewrite free-text location and hometown values into
// canonical "City, Region, Country" labels, repairing flattened hometown arrays
// and suburb ⊏ metro hierarchy where it can be inferred.
//
// Run with: npx tsx scripts/normalize-places.ts [--dry-run]

import { db, updatePerson } from "../server/db.js";
import { normalizeHometownValue, normalizeLocationValue } from "../server/geo/normalize.js";

const dryRun = process.argv.includes("--dry-run");

const rows = db.prepare(`
  SELECT p.id, m.location, m.hometown
  FROM people p
  JOIN nett_metadata m ON m.person_id = p.id
  WHERE TRIM(COALESCE(m.location, '')) <> ''
     OR TRIM(COALESCE(m.hometown, '')) <> ''
`).all() as { id: string; location: string | null; hometown: string | null }[];

let locationChanged = 0;
let hometownChanged = 0;
let unchanged = 0;

for (const row of rows) {
  const patch: Record<string, unknown> = {};
  if (row.location?.trim()) {
    const next = await normalizeLocationValue(row.location);
    if (next !== row.location) {
      patch.location = next;
      locationChanged += 1;
    }
  }
  if (row.hometown?.trim()) {
    let current: unknown = row.hometown;
    try {
      current = JSON.parse(row.hometown);
    } catch {
      current = row.hometown;
    }
    const next = await normalizeHometownValue(current);
    const currentList = Array.isArray(current)
      ? current.map(String)
      : [String(current)];
    if (JSON.stringify(next) !== JSON.stringify(currentList)) {
      patch.hometown = next;
      hometownChanged += 1;
    }
  }
  if (!Object.keys(patch).length) {
    unchanged += 1;
    continue;
  }
  if (!dryRun) updatePerson(row.id, patch, "place-normalize");
  else {
    console.log(row.id, patch);
  }
}

console.log(
  `${dryRun ? "[dry-run] " : ""}locations ${locationChanged}, hometowns ${hometownChanged}, unchanged ${unchanged}`,
);
