import { performance } from "node:perf_hooks";

const { overview, summarizePeople, peopleFacets, db } = await import("../server/db.ts");
const { setupStatus } = await import("../server/setup.ts");

const time = (label, fn) => {
  fn();
  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    const start = performance.now();
    fn();
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  console.log(`${label.padEnd(28)} ${runs[2].toFixed(1)} ms`);
};

time("overview()", () => overview());
time("setupStatus()", () => setupStatus());
time("peopleFacets()", () => peopleFacets());
time("stats query", () => db.prepare(`
  SELECT COUNT(*) AS total FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
`).get());
time("grouped(location)", () => db.prepare(`
  SELECT COALESCE(NULLIF(TRIM(m.location), ''), 'Unknown') AS label, COUNT(*) AS count
  FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
  GROUP BY label ORDER BY count DESC, label ASC LIMIT 20
`).all());
time("summarizePeople(249)", () => {
  const ids = db.prepare("SELECT id FROM people LIMIT 249").all().map((r) => r.id);
  return summarizePeople(ids);
});
