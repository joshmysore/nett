// Reproducible browser measurement for Nett.
// Usage: node scripts/measure.mjs <label>   (writes docs/audits/<label>.json + screenshots)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const label = process.argv[2] || "baseline";
const base = process.env.NETT_BASE_URL || "http://127.0.0.1:5173";
const outDir = path.resolve(`docs/audits/${label}-screens`);
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "414x896", width: 414, height: 896 },
  { name: "375x812", width: 375, height: 812 },
  { name: "320x700", width: 320, height: 700 },
];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10;
};

const results = { label, base, startedAt: new Date().toISOString(), metrics: {}, notes: [] };
const record = (key, values, unit = "ms") => {
  results.metrics[key] = { median: median(values), samples: values.map((v) => Math.round(v)), unit };
  console.log(`${key.padEnd(46)} median=${median(values)}${unit}  [${values.map((v) => Math.round(v)).join(", ")}]`);
};
// A failed section must be reported as unavailable rather than silently skewing the report.
async function section(name, run) {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.notes.push(`section "${name}" failed: ${message}`);
    console.log(`!! section "${name}" failed: ${message}`);
  }
}

const browser = await chromium.launch();

async function newPage(viewport = VIEWPORTS[0], colorScheme = "dark") {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  return { context, page };
}

// --- 1. Cold app load: navigation start to first meaningful app content ---
await section("cold-load", async () => {
  const values = [];
  const transfer = [];
  for (let i = 0; i < 5; i += 1) {
    const { context, page } = await newPage();
    let peopleRowsTransferred = 0;
    page.on("response", async (response) => {
      if (response.url().includes("/api/bootstrap")) {
        try {
          const body = await response.json();
          peopleRowsTransferred = Array.isArray(body.people) ? body.people.length : 0;
        } catch { /* ignore */ }
      }
    });
    const started = Date.now();
    await page.goto(`${base}/`, { waitUntil: "commit" });
    await page.waitForSelector("main h1, .page-heading h1, .dashboard-heading h1", { timeout: 30_000 });
    values.push(Date.now() - started);
    transfer.push(peopleRowsTransferred);
    await context.close();
  }
  record("app.cold-load-to-first-heading", values);
  results.metrics["app.bootstrap-people-rows-transferred"] = { median: median(transfer), samples: transfer, unit: "rows" };
  console.log(`app.bootstrap-people-rows-transferred      median=${median(transfer)} rows`);
});

// --- 2. Loaded route navigation (dashboard -> people) ---
await section("route-nav", async () => {
  const { context, page } = await newPage();
  await page.goto(`${base}/today`);
  await page.waitForSelector("main h1, .page-heading h1");
  const values = [];
  for (let i = 0; i < 5; i += 1) {
    await page.goto(`${base}/today`);
    await page.waitForSelector("main h1, .page-heading h1");
    const started = Date.now();
    await page.getByRole("link", { name: /People/ }).first().click();
    await page.waitForSelector(".person-row, .people-row, .evidence-packet, .person-glow-card", { timeout: 20_000 });
    values.push(Date.now() - started);
  }
  record("route.dashboard-to-people-first-row", values);
  await context.close();
});

// --- 3. People page direct load ---
await section("people-load", async () => {
  const values = [];
  for (let i = 0; i < 5; i += 1) {
    const { context, page } = await newPage();
    const started = Date.now();
    await page.goto(`${base}/people`, { waitUntil: "commit" });
    await page.waitForSelector(".person-row, .people-row, .evidence-packet, .person-glow-card", { timeout: 30_000 });
    values.push(Date.now() - started);
    await context.close();
  }
  record("people.cold-load-to-first-row", values);
});

// --- 4. Search: keystroke to visible feedback, and to settled results ---
// Both are measured inside the page so the numbers reflect paint, not Playwright round-trips.
await section("search", async () => {
  const { context, page } = await newPage();
  await page.goto(`${base}/people`);
  const rowSelector = ".person-row, .people-row, .evidence-packet, .person-glow-card";
  await page.waitForSelector(rowSelector);
  const feedback = [];
  const settled = [];
  const terms = ["a", "an", "mar", "maria", "jo"];
  for (const term of terms) {
    const measured = await page.evaluate(
      async ({ term, rowSelector }) => {
        const input = document.querySelector('input[type="search"]');
        if (!input) throw new Error("no search input found");
        const setValue = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set;
        const paint = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
        const rowSignature = () =>
          Array.from(document.querySelectorAll(rowSelector))
            .slice(0, 5)
            .map((row) => row.textContent)
            .join("|");

        setValue.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 700));
        const before = rowSignature();

        const started = performance.now();
        setValue.call(input, term);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        // First paint after the keystroke: what the user perceives as "the app reacted".
        const painted = await paint();
        const feedbackMs = painted - started;

        const deadline = performance.now() + 15_000;
        let changed = false;
        while (performance.now() < deadline) {
          if (rowSignature() !== before) {
            changed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
        return { feedbackMs, settledMs: performance.now() - started, changed };
      },
      { term, rowSelector },
    );
    feedback.push(measured.feedbackMs);
    settled.push(measured.settledMs);
    if (!measured.changed) results.notes.push(`search results did not change for "${term}" within 15s`);
  }
  record("search.keystroke-to-visible-feedback", feedback);
  record("search.keystroke-to-settled-results", settled);
  await context.close();
});

// --- 5. Person drawer: click to first useful content ---
await section("drawer", async () => {
  const { context, page } = await newPage();
  await page.goto(`${base}/people`);
  await page.waitForSelector(".person-row, .people-row, .evidence-packet, .person-glow-card");
  const values = [];
  for (let i = 0; i < 5; i += 1) {
    const row = page.locator(".person-row, .people-row, .evidence-packet, .person-glow-card").nth(i);
    const started = Date.now();
    await row.click();
    await page.waitForSelector('[role="dialog"] h1, [role="dialog"] h2', { timeout: 20_000 });
    values.push(Date.now() - started);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }
  record("drawer.open-to-first-useful-content", values);
  await context.close();
});

// --- 6. Profile route: request to first useful content ---
await section("profile", async () => {
  const response = await fetch(`${(process.env.NETT_API_URL || "http://127.0.0.1:4174")}/api/people/page?limit=5`);
  const payload = await response.json();
  const values = [];
  for (const person of payload.people.slice(0, 5)) {
    const { context, page } = await newPage();
    const started = Date.now();
    await page.goto(`${base}/people/${person.id}`, { waitUntil: "commit" });
    await page.waitForSelector("h1", { timeout: 30_000 });
    values.push(Date.now() - started);
    await context.close();
  }
  record("profile.cold-load-to-name-visible", values);
});

// --- 7. Layout shifts + long tasks on the People route ---
await section("cls-longtasks", async () => {
  const { context, page } = await newPage();
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(`${base}/people`);
  await page.waitForSelector(".person-row, .people-row, .evidence-packet, .person-glow-card");
  await page.waitForTimeout(2500);
  const cls = await page.evaluate(() => window.__cls);
  const longTasks = await page.evaluate(() => window.__longTasks);
  results.metrics["people.cumulative-layout-shift"] = { median: Math.round(cls * 1000) / 1000, samples: [cls], unit: "score" };
  results.metrics["people.long-tasks-over-50ms"] = { median: longTasks.length, samples: longTasks, unit: "count" };
  console.log(`people.cumulative-layout-shift                 ${Math.round(cls * 1000) / 1000}`);
  console.log(`people.long-tasks-over-50ms                    ${longTasks.length} [${longTasks.join(", ")}]`);
  await context.close();
});

// --- 8. Screenshots + horizontal overflow across viewports and modes ---
const routes = [
  { name: "dashboard", url: "/" },
  { name: "people", url: "/people" },
  { name: "connectors", url: "/settings/connectors" },
];
const overflow = {};
for (const scheme of ["dark", "light"]) {
  for (const viewport of VIEWPORTS) {
    const { context, page } = await newPage(viewport, scheme);
    for (const route of routes) {
      await page.goto(`${base}${route.url}`);
      await page.waitForSelector("h1", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(500);
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      overflow[`${scheme}/${viewport.name}/${route.name}`] = scrollWidth;
      await page.screenshot({
        path: path.join(outDir, `${scheme}-${viewport.name}-${route.name}.png`),
        fullPage: true,
      });
    }
    await context.close();
  }
}
results.horizontalOverflowPx = overflow;
const offenders = Object.entries(overflow).filter(([, value]) => value > 1);
console.log(`\nhorizontal overflow offenders: ${offenders.length}`);
offenders.forEach(([key, value]) => console.log(`  ${key}: ${value}px`));

results.finishedAt = new Date().toISOString();
writeFileSync(path.resolve(`docs/audits/${label}.json`), `${JSON.stringify(results, null, 2)}\n`);
console.log(`\nWrote docs/audits/${label}.json and ${outDir}`);
await browser.close();
