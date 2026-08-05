// Normalise every stored culture value through normalizeCultureValue.
// Owner-entered free text (newlines, "chinese", "half indian, half white", …)
// becomes canonical multi-label strings. Provenance connector is preserved as
// "nett" when the previous latest source was owner/csv, otherwise rewritten
// through updatePerson with the same connector when possible.
//
// Run with: npx tsx scripts/normalize-culture.ts [--dry-run]

import { db, updatePerson } from "../server/db.js";
import { normalizeCultureValue } from "../server/intelligence/culture.js";

const dryRun = process.argv.includes("--dry-run");

const rows = db.prepare(`
  SELECT p.id, p.preferred_name AS name, m.culture,
    (
      SELECT fp.connector_id FROM field_provenance fp
      WHERE fp.person_id = p.id AND fp.field_name = 'culture'
      ORDER BY fp.observed_at DESC, fp.rowid DESC
      LIMIT 1
    ) AS source
  FROM people p
  JOIN nett_metadata m ON m.person_id = p.id
  WHERE TRIM(COALESCE(m.culture, '')) != ''
`).all() as { id: string; name: string; culture: string; source: string | null }[];

let changed = 0;
let same = 0;
const samples: string[] = [];

for (const row of rows) {
  const next = normalizeCultureValue(row.culture);
  if (!next) {
    samples.push(`CLEAR ${JSON.stringify(row.culture)} ← ${row.name}`);
    if (!dryRun) updatePerson(row.id, { culture: "" }, row.source || "nett");
    changed += 1;
    continue;
  }
  if (next === row.culture) {
    same += 1;
    continue;
  }
  changed += 1;
  if (samples.length < 40) samples.push(`${JSON.stringify(row.culture)} → ${next}  (${row.name})`);
  if (!dryRun) updatePerson(row.id, { culture: next }, row.source || "nett");
}

console.log(`${dryRun ? "[dry run] " : ""}rows: ${rows.length}, changed: ${changed}, already canonical: ${same}`);
console.log(samples.join("\n"));
