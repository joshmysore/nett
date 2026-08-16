/**
 * Investor walkthrough. Playwright drives the real app against an isolated
 * demo database. Output is a silent (or narrated) MP4 with an oversized
 * cursor and punch-in zooms.
 *
 *   npm run demo:record
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { type DemoPerson } from "./ask-standin.ts";
import { seedInvestorDemo, DEMO_DB } from "./seed.ts";
import { mixNarration, trySynthesizeNarration } from "./narration.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ARTIFACT_DIR = process.env.NETT_DEMO_OUT || "/opt/cursor/artifacts";
const RAW_DIR = path.join(ROOT, "docs/demo/output");
const OVERLAY = readFileSync(path.join(import.meta.dirname, "overlay.js"), "utf8");
const ASK_STANDIN = readFileSync(path.join(import.meta.dirname, "ask-standin.js"), "utf8");

const BASE = process.env.NETT_BASE_URL || "http://127.0.0.1:5173";
const API = process.env.NETT_API_URL || "http://127.0.0.1:4174";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url: string, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function freeDemoPorts() {
  for (const port of [5173, 5174, 5175, 4174]) {
    const listed = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
    for (const pid of listed.stdout.split(/\s+/).filter(Boolean)) {
      spawnSync("kill", ["-9", pid], { stdio: "ignore" });
    }
  }
}

function startDevServer(): { stop: () => void } {
  const env = {
    ...process.env,
    NETT_DB_PATH: DEMO_DB,
    NETT_MESSAGES_DB: path.join(path.dirname(DEMO_DB), "nett-demo-messages.db"),
  };
  const children = [
    spawn("npx", ["tsx", "server/index.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] }),
    spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ];
  children[0].stdout?.on("data", (chunk) => process.stdout.write(`[api] ${chunk}`));
  children[0].stderr?.on("data", (chunk) => process.stderr.write(`[api] ${chunk}`));
  children[1].stdout?.on("data", (chunk) => process.stdout.write(`[web] ${chunk}`));
  children[1].stderr?.on("data", (chunk) => process.stderr.write(`[web] ${chunk}`));
  return {
    stop() {
      for (const child of children) {
        if (child.pid) spawnSync("kill", ["-9", String(child.pid)], { stdio: "ignore" });
        child.kill("SIGKILL");
      }
    },
  };
}

async function ensureOverlay(page: Page) {
  const ready = await page.evaluate(() => Boolean(window.__nettDemo));
  if (!ready) await page.addInitScript(OVERLAY);
  await page.evaluate(OVERLAY);
  await page.evaluate(() => window.__nettDemo.mount());
}

async function pointOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("No bounding box");
  return { x: box.x + box.width * 0.55, y: box.y + Math.min(box.height * 0.55, 22), box };
}

async function cursorAt(page: Page) {
  return page.evaluate(() => {
    const cursor = document.querySelector(".nett-demo-cursor") as HTMLElement | null;
    return {
      x: Number.parseFloat(cursor?.style.left || "80"),
      y: Number.parseFloat(cursor?.style.top || "80"),
    };
  });
}

async function moveTo(page: Page, locator: Locator, ms = 640) {
  await ensureOverlay(page);
  const { x, y } = await pointOf(locator);
  const from = await cursorAt(page);
  const steps = 20;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
    await page.evaluate(({ x, y }) => window.__nettDemo.place(x, y), {
      x: from.x + (x - from.x) * e,
      y: from.y + (y - from.y) * e,
    });
    await sleep(ms / steps);
  }
}

async function zoomTo(page: Page, locator: Locator, scale = 1.28) {
  const { x, y } = await pointOf(locator);
  await page.evaluate(({ x, y, scale }) => {
    window.__nettDemo.zoomTo(x, y, scale);
  }, { x, y, scale });
  await sleep(420);
}

async function zoomReset(page: Page) {
  await page.evaluate(() => window.__nettDemo.zoomReset());
  await sleep(320);
}

async function softClick(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);
  await sleep(140);
  await moveTo(page, locator, 520);
  await page.evaluate(() => window.__nettDemo.clickPulse());
  try {
    await locator.click({ force: true, timeout: 2500 });
  } catch {
    await locator.evaluate((node) => (node as HTMLElement).click());
  }
  await sleep(480);
}

async function punchClick(page: Page, locator: Locator, options: { stay?: boolean } = {}) {
  await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);
  await sleep(180);
  await moveTo(page, locator, 560);
  await zoomTo(page, locator, 1.28);
  await page.evaluate(() => window.__nettDemo.clickPulse());
  try {
    await locator.click({ force: true, timeout: 2500 });
  } catch {
    await zoomReset(page);
    await locator.evaluate((node) => (node as HTMLElement).click());
  }
  await sleep(options.stay ? 260 : 720);
  if (!options.stay) await zoomReset(page);
}

async function typeHuman(page: Page, locator: Locator, text: string, delay = 38) {
  await locator.click({ force: true });
  await locator.fill("");
  await locator.pressSequentially(text, { delay });
}

function mockOwnedSources(page: Page) {
  const now = new Date().toISOString();
  return Promise.all([
    page.route("**/api/connectors/messages/status", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          source: "local_copy",
          usingLocalCopy: true,
          usingEnv: false,
          localCopyExists: true,
          systemExists: false,
          readable: true,
          messageCount: 1842,
          bytes: 12_400_000,
          preparedAt: now,
          syncCursor: { lastRowId: 1842, lastGuid: null },
          error: null,
        }),
      });
    }),
    page.route("**/api/connectors/whatsapp/status", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          binary: "/usr/local/bin/wacrawl",
          binaryFound: true,
          sourcePath: "/tmp/whatsapp-demo",
          desktopExists: true,
          desktopAvailable: true,
          desktopMessageCount: 640,
          desktopChatCount: 42,
          desktopContactCount: 38,
          oldestMessage: "2024-01-12T00:00:00.000Z",
          newestMessage: now,
          archivePath: "/tmp/whatsapp-demo/archive",
          archiveExists: true,
          archiveReadable: true,
          archiveMessageCount: 640,
          archiveBytes: 4_200_000,
          lastArchiveImportAt: now,
          preparedAt: now,
          syncCursor: { lastRowId: 640 },
          readable: true,
          error: null,
        }),
      });
    }),
    page.route("**/api/connectors/messages/prepare", async (route) => {
      await sleep(700);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          messageCount: 1842,
          bytes: 12_400_000,
          preparedAt: now,
          cursorReset: false,
          syncCursor: { lastRowId: 1842, lastGuid: null },
          message: "Messages copy is current.",
        }),
      });
    }),
    page.route("**/api/connectors/whatsapp/prepare", async (route) => {
      await sleep(700);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          messageCount: 640,
          bytes: 4_200_000,
          preparedAt: now,
          cursorReset: false,
          archivePath: "/tmp/whatsapp-demo/archive",
          syncCursor: { lastRowId: 640 },
          message: "WhatsApp archive is current.",
        }),
      });
    }),
    page.route("**/api/connectors/messages/sync", async (route) => {
      await sleep(900);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ message: "Messages copy is current. No new records since the last import.", seen: 0, done: true }),
      });
    }),
    page.route("**/api/connectors/whatsapp/sync", async (route) => {
      await sleep(900);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ message: "WhatsApp archive is current. No new records since the last import.", seen: 0, done: true }),
      });
    }),
  ]);
}

async function waitForAskAnswer(page: Page, asked: string) {
  const turn = page.locator(".ask-turn").filter({ hasText: asked }).last();
  await turn.locator(".ask-thinking").waitFor({ state: "visible", timeout: 20_000 });
  await turn.locator(".ask-actions").waitFor({ state: "visible", timeout: 90_000 });
  await turn.locator(".ask-answer").waitFor({ state: "visible" });
  await turn.evaluate((node) => node.scrollIntoView({ block: "start" }));
}

async function expandAskEvidence(page: Page, asked: string) {
  const turn = page.locator(".ask-turn").filter({ hasText: asked }).last();
  await turn.locator(".ask-thinking-block").waitFor({ state: "visible" });
  await turn.evaluate((node) => node.scrollIntoView({ block: "start" }));
  await sleep(2800);
  const summary = turn.locator(".ask-evidence summary");
  if (await summary.count()) {
    await softClick(page, summary);
    await sleep(1800);
  }
  await turn.evaluate((node) => node.scrollIntoView({ block: "start" }));
}

async function walkthrough(page: Page, mark: (id: string) => void) {
  await mockOwnedSources(page);

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.locator("#landing-title").waitFor({ state: "visible" });
  mark("landing");
  await sleep(3200);
  const title = page.locator("#landing-title");
  if (await title.count()) {
    await Promise.race([moveTo(page, title, 1400), sleep(1800)]).catch(() => undefined);
  }
  await sleep(4200);
  const openNett = page.getByRole("link", { name: /Open Nett/ }).first();
  if (await openNett.count()) {
    await Promise.race([moveTo(page, openNett, 1600), sleep(2000)]).catch(() => undefined);
  }
  await sleep(4800);

  mark("workbench");
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator("#ask-nett-query").waitFor({ state: "visible", timeout: 20_000 });
  const standin = await page.evaluate(() => Boolean(window.__nettAskStandin));
  console.log("Ask stand-in", standin);
  await sleep(3200);

  const rail = (label: string) => page.locator(".rail-link", { hasText: label }).first();

  mark("people");
  await softClick(page, rail("People"));
  await page.locator(".people-cards").waitFor({ state: "visible" });
  await sleep(1800);
  await page.mouse.wheel(0, 420);
  await sleep(1800);
  await page.mouse.wheel(0, 380);
  await sleep(1600);
  await page.mouse.wheel(0, -700);
  await sleep(2800);

  mark("review");
  await softClick(page, rail("Review"));
  const accept = page.locator(".review-card").getByRole("button", { name: "Accept" }).first();
  await accept.waitFor({ state: "visible", timeout: 20_000 });
  await sleep(1100);
  await punchClick(page, accept);
  await sleep(1600);

  mark("sources");
  await softClick(page, rail("Sources"));
  await page.locator(".source-glow-card").first().waitFor({ state: "visible" });
  await sleep(1800);
  const messages = page.locator(".source-glow-card", { hasText: "Messages" }).getByRole("button", { name: /Pull|Refresh/ }).first();
  await softClick(page, messages);
  await page.locator(".source-glow-card", { hasText: "Messages" }).getByRole("button", { name: /Pull|Refresh/ }).waitFor({ state: "visible", timeout: 20_000 });
  await sleep(900);
  const whatsapp = page.locator(".source-glow-card", { hasText: "WhatsApp" }).getByRole("button", { name: /Pull|Refresh/ }).first();
  await softClick(page, whatsapp);
  await page.locator(".source-glow-card", { hasText: "WhatsApp" }).getByRole("button", { name: /Pull|Refresh/ }).waitFor({ state: "visible", timeout: 20_000 });
  await sleep(3200);

  await softClick(page, rail("People"));
  await page.locator(".people-cards").waitFor({ state: "visible" });
  await sleep(700);
  mark("kendra");
  await punchClick(page, page.getByRole("button", { name: "Open Kendra Mysore" }));
  await page.getByRole("button", { name: "Open full profile" }).waitFor({ state: "visible" });
  await sleep(1800);
  await softClick(page, page.getByRole("button", { name: "Open full profile" }));
  await page.locator("h1", { hasText: "Kendra Mysore" }).waitFor({ state: "visible" });
  await sleep(4200);

  mark("kendra_note");
  await softClick(page, page.getByRole("button", { name: "Edit profile" }));
  const notes = page.locator("label.full-field").filter({ hasText: "Notes" }).locator("textarea");
  await notes.waitFor({ state: "visible" });
  await notes.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await moveTo(page, notes);
  await typeHuman(page, notes, "Will be home the week she visits. She is bringing the photo albums.");
  await softClick(page, page.getByRole("button", { name: "Save profile" }));
  await page.getByRole("button", { name: "Edit profile" }).waitFor({ state: "visible" });
  await sleep(800);

  await softClick(page, page.locator(".profile-actions").getByRole("button", { name: "Record a memory" }));
  await typeHuman(page, page.locator("#profile-memory"), "Told her I will be home that week. She is bringing the photo albums.");
  await softClick(page, page.getByRole("button", { name: "Save as written" }));
  await sleep(1600);

  await softClick(page, page.locator(".back-link"));
  await page.locator(".people-cards").waitFor({ state: "visible" });
  mark("gilly");
  await softClick(page, page.getByRole("button", { name: "Open Gilly Zaid" }));
  await page.getByRole("button", { name: "Open full profile" }).waitFor({ state: "visible" });
  await sleep(3800);

  mark("ask");
  await page.keyboard.press("Escape").catch(() => undefined);
  await sleep(400);
  await softClick(page, rail("Ask"));
  try {
    await page.locator("#ask-nett-query").waitFor({ state: "visible", timeout: 8000 });
  } catch {
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.locator("#ask-nett-query").waitFor({ state: "visible", timeout: 20_000 });
  }
  await sleep(800);
  const ask = page.locator("#ask-nett-query");
  await moveTo(page, ask);
  await typeHuman(page, ask, "What do I know about Kendra Mysore?");
  await softClick(page, page.locator("button.ask-send"));
  await waitForAskAnswer(page, "What do I know about Kendra Mysore?");
  await expandAskEvidence(page, "What do I know about Kendra Mysore?");
  await sleep(36_000);

  mark("synthesis");
  await moveTo(page, ask);
  await typeHuman(page, ask, "Who might I know that would be a good lead for legal tech?");
  await softClick(page, page.locator("button.ask-send"));
  await waitForAskAnswer(page, "Who might I know that would be a good lead for legal tech?");
  await expandAskEvidence(page, "Who might I know that would be a good lead for legal tech?");
  await page.mouse.wheel(0, 220);
  await sleep(2200);
  await page.mouse.wheel(0, 260);
  await sleep(68_000);

  mark("remember");
  await softClick(page, page.locator(".rail-remember"));
  const composer = page.locator(".memory-composer textarea");
  await composer.waitFor({ state: "visible" });
  await typeHuman(
    page,
    composer,
    "Gilly Zaid likes photography. Follow up in 5 days about dinner.",
  );
  await softClick(page, page.getByRole("button", { name: "Structure into fields" }));
  const savePerson = page.getByRole("button", { name: "Save to person" });
  await savePerson.waitFor({ state: "visible", timeout: 60_000 });
  await sleep(1200);
  await punchClick(page, savePerson);
  await sleep(8000);
}

async function encodeMp4(
  webm: string,
  mp4: string,
  clips: Array<{ path: string; atMs: number }> | null,
) {
  if (clips?.length) {
    mixNarration(webm, clips, mp4);
    return;
  }
  const result = spawnSync("ffmpeg", [
    "-y",
    "-i", webm,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    mp4,
  ], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("ffmpeg failed");
}

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  console.log("Seeding isolated demo database…");
  await seedInvestorDemo(DEMO_DB);
  freeDemoPorts();
  await sleep(400);

  const server = startDevServer();
  const stop = () => server.stop();
  process.on("exit", stop);
  try {
    await waitForHttp(`${API}/api/health`);
    await waitForHttp(BASE);
    const inbox = await fetch(`${API}/api/review`).then((response) => response.json()) as {
      counts?: { total?: number };
      suggestions?: Array<{ personName: string; fieldName: string }>;
    };
    const kendra = await fetch(`${API}/api/people/page?q=Kendra&limit=5`).then((response) => response.json()) as {
      people?: Array<{ name: string }>;
    };
    console.log("Demo inbox", inbox.counts, inbox.suggestions);
    if (!kendra.people?.some((person) => person.name.includes("Kendra"))) {
      throw new Error("Demo database is not the isolated investor seed");
    }
    if (!inbox.suggestions?.length) {
      throw new Error("Review inbox is empty — the API is not serving the seeded demo database");
    }
    const directory = await fetch(`${API}/api/people/page?limit=40`).then((response) => response.json()) as {
      people?: DemoPerson[];
    };
    const people = directory.people ?? [];
    if (!people.some((row) => row.name === "Dana Ruiz") || !people.some((row) => row.name === "Noor Alvi")) {
      throw new Error("Demo seed is missing the legal-tech cluster");
    }
    console.log("Recording…");

    const browser = await chromium.launch({
      headless: process.env.NETT_DEMO_HEADED === "1" ? false : true,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
      recordVideo: { dir: RAW_DIR, size: { width: 1440, height: 900 } },
    });
    context.setDefaultTimeout(12_000);
    context.setDefaultNavigationTimeout(15_000);
    await context.addInitScript(OVERLAY);
    await context.addInitScript(`window.__nettDemoPeople = ${JSON.stringify(people)};`);
    await context.addInitScript(ASK_STANDIN);
    const page = await context.newPage();
    page.on("pageerror", (error) => console.warn("pageerror", error.message));
    const origin = Date.now();
    const marks = new Map<string, number>();
    const mark = (id: string) => {
      marks.set(id, Date.now() - origin);
      console.log(`beat ${id} @ ${marks.get(id)}ms`);
    };

    try {
      await walkthrough(page, mark);
    } catch (error) {
      const shot = path.join(ARTIFACT_DIR, "nett-investor-demo-failure.png");
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
      console.error("Walkthrough failed. Screenshot:", shot);
      throw error;
    }

    const video = page.video();
    await context.close();
    await browser.close();
    if (!video) throw new Error("Playwright did not record a video");
    const webm = await video.path();

    writeFileSync(path.join(RAW_DIR, "marks.json"), JSON.stringify(Object.fromEntries(marks), null, 2));
    const synthesized = await trySynthesizeNarration(RAW_DIR);
    const timed = synthesized
      ?.map((clip) => {
        const atMs = marks.get(clip.id);
        return atMs == null ? null : { path: clip.path, atMs };
      })
      .filter((clip): clip is { path: string; atMs: number } => Boolean(clip)) ?? null;

    const mp4 = path.join(ARTIFACT_DIR, "nett-investor-demo.mp4");
    const repoCopy = path.join(RAW_DIR, "nett-investor-demo.mp4");
    await encodeMp4(webm, mp4, timed);
    writeFileSync(path.join(RAW_DIR, "source.webm.txt"), webm);
    copyFileSync(mp4, repoCopy);
    console.log(`Wrote ${mp4}`);
    console.log("Beats", Object.fromEntries(marks));
  } finally {
    stop();
    await sleep(200);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
