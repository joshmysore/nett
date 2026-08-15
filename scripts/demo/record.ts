/**
 * Investor walkthrough. Playwright drives the real app against an isolated
 * demo database. Output is a silent (or narrated) MP4 with an oversized
 * cursor and punch-in zooms.
 *
 *   npm run demo:record
 */
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { seedInvestorDemo, DEMO_DB } from "./seed.ts";
import { mixNarration, trySynthesizeNarration } from "./narration.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ARTIFACT_DIR = process.env.NETT_DEMO_OUT || "/opt/cursor/artifacts";
const RAW_DIR = path.join(ROOT, "docs/demo/output");
const OVERLAY = readFileSync(path.join(import.meta.dirname, "overlay.js"), "utf8");

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

function startDevServer(): ChildProcess {
  const child = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NETT_DB_PATH: DEMO_DB,
      NETT_MESSAGES_DB: path.join(path.dirname(DEMO_DB), "nett-demo-messages.db"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[dev] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[dev] ${chunk}`));
  return child;
}

async function pointOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("No bounding box");
  return { x: box.x + box.width * 0.55, y: box.y + Math.min(box.height * 0.55, 22), box };
}

async function moveTo(page: Page, locator: Locator, ms = 720) {
  const { x, y } = await pointOf(locator);
  await page.evaluate(async ({ x, y, ms }) => {
    await window.__nettDemo.moveTo(x, y, ms);
  }, { x, y, ms });
}

async function zoomTo(page: Page, locator: Locator, scale = 1.16) {
  const { x, y } = await pointOf(locator);
  await page.evaluate(({ x, y, scale }) => {
    window.__nettDemo.zoomTo(x, y, scale);
  }, { x, y, scale });
  await sleep(420);
}

async function zoomReset(page: Page) {
  await page.evaluate(() => window.__nettDemo.zoomReset());
  await sleep(360);
}

async function punchClick(page: Page, locator: Locator, options: { scale?: number; stay?: boolean } = {}) {
  await locator.scrollIntoViewIfNeeded();
  await moveTo(page, locator);
  await zoomTo(page, locator, options.scale ?? 1.16);
  await page.evaluate(() => window.__nettDemo.clickPulse());
  await locator.click({ force: true });
  await sleep(280);
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

async function walkthrough(page: Page) {
  await mockOwnedSources(page);

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator("#landing-title").waitFor({ state: "visible" });
  await sleep(6200);

  const about = page.locator(".landing-nav-about");
  await punchClick(page, about);
  await page.locator(".nett-about-page").waitFor({ state: "visible" });
  await sleep(900);
  for (const y of [420, 980, 1600, 2300]) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
    await sleep(2100);
  }
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  await sleep(1600);

  const openNett = page.locator(".landing-about-close .landing-glass-cta__link");
  await punchClick(page, openNett);
  await page.locator("#ask-nett-query").waitFor({ state: "visible", timeout: 20_000 });
  await sleep(2400);

  const rail = (label: string) => page.locator(".rail-link", { hasText: label }).first();

  await punchClick(page, rail("People"));
  await page.locator(".people-cards").waitFor({ state: "visible" });
  await sleep(800);
  await page.mouse.wheel(0, 520);
  await sleep(1400);
  await page.mouse.wheel(0, 420);
  await sleep(1200);
  await page.mouse.wheel(0, -700);
  await sleep(900);

  await punchClick(page, rail("Review"));
  await page.locator(".review-page").waitFor({ state: "visible" });
  await sleep(1100);
  const accept = page.locator(".review-card", { hasText: "Gilly Zaid" }).getByRole("button", { name: "Accept" });
  await punchClick(page, accept);
  await sleep(1400);

  await punchClick(page, rail("Sources"));
  await page.locator(".source-glow-card").first().waitFor({ state: "visible" });
  await sleep(900);
  const messages = page.locator(".source-glow-card", { hasText: "Messages" }).getByRole("button", { name: /Pull|Refresh/ }).first();
  await punchClick(page, messages);
  await page.locator(".source-glow-card", { hasText: "Messages" }).getByRole("button", { name: /Pull|Refresh/ }).waitFor({ state: "visible", timeout: 20_000 });
  await sleep(700);
  const whatsapp = page.locator(".source-glow-card", { hasText: "WhatsApp" }).getByRole("button", { name: /Pull|Refresh/ }).first();
  await punchClick(page, whatsapp);
  await page.locator(".source-glow-card", { hasText: "WhatsApp" }).getByRole("button", { name: /Pull|Refresh/ }).waitFor({ state: "visible", timeout: 20_000 });
  await sleep(1000);

  await punchClick(page, rail("People"));
  await page.locator(".people-cards").waitFor({ state: "visible" });
  await sleep(600);
  const kendraCard = page.getByRole("button", { name: "Open Kendra Mysore" });
  await punchClick(page, kendraCard);
  await page.getByRole("button", { name: "Open full profile" }).waitFor({ state: "visible" });
  await sleep(1100);
  await punchClick(page, page.getByRole("button", { name: "Open full profile" }));
  await page.locator("h1", { hasText: "Kendra Mysore" }).waitFor({ state: "visible" });
  await sleep(900);

  await punchClick(page, page.getByRole("button", { name: "Edit profile" }));
  const followUp = page.getByLabel("Follow-up date");
  await followUp.waitFor({ state: "visible" });
  await moveTo(page, followUp);
  await zoomTo(page, followUp, 1.14);
  await followUp.fill("2026-09-08");
  await sleep(500);
  await zoomReset(page);
  await punchClick(page, page.getByRole("button", { name: "Save profile" }));
  await page.getByRole("button", { name: "Edit profile" }).waitFor({ state: "visible" });
  await sleep(700);

  await punchClick(page, page.getByRole("button", { name: "Record a memory" }), { stay: true });
  const kendraMemory = page.locator("#profile-memory");
  await typeHuman(page, kendraMemory, "Told her I will be home that week. She is bringing the photo albums.");
  await zoomReset(page);
  await punchClick(page, page.getByRole("button", { name: "Save as written" }));
  await sleep(1400);

  await punchClick(page, page.locator(".back-link"));
  await page.locator(".people-cards").waitFor({ state: "visible" });
  const gillyCard = page.getByRole("button", { name: "Open Gilly Zaid" });
  await punchClick(page, gillyCard);
  await page.getByRole("button", { name: "Open full profile" }).waitFor({ state: "visible" });
  await sleep(800);
  await punchClick(page, page.getByRole("button", { name: "Open full profile" }));
  await page.locator("h1", { hasText: "Gilly Zaid" }).waitFor({ state: "visible" });
  await sleep(800);
  await punchClick(page, page.getByRole("button", { name: "Record a memory" }), { stay: true });
  await typeHuman(page, page.locator("#profile-memory"), "If he comes through the city this month, dinner — no agenda.");
  await zoomReset(page);
  await punchClick(page, page.getByRole("button", { name: "Save as written" }));
  await sleep(1200);

  await punchClick(page, rail("Ask"));
  await page.locator("#ask-nett-query").waitFor({ state: "visible" });
  await sleep(600);
  const ask = page.locator("#ask-nett-query");
  await moveTo(page, ask);
  await zoomTo(page, ask, 1.12);
  await typeHuman(page, ask, "Can you tell me more about Kendra Mysore?");
  await zoomReset(page);
  await punchClick(page, page.locator("button.ask-send"));
  await page.getByRole("button", { name: "Stop asking" }).waitFor({ timeout: 8_000 }).catch(() => undefined);
  await page.locator(".ask-answer").first().waitFor({ state: "visible", timeout: 90_000 });
  await page.getByRole("button", { name: "Ask" }).waitFor({ timeout: 90_000 });
  await sleep(2800);

  await moveTo(page, ask);
  await zoomTo(page, ask, 1.12);
  await typeHuman(page, ask, "Describe Gilly Zaid's history.");
  await zoomReset(page);
  await punchClick(page, page.locator("button.ask-send"));
  await page.getByRole("button", { name: "Stop asking" }).waitFor({ timeout: 8_000 }).catch(() => undefined);
  await page.locator(".ask-answer").nth(1).waitFor({ state: "visible", timeout: 90_000 }).catch(async () => {
    await page.locator(".ask-answer").first().waitFor({ state: "visible", timeout: 90_000 });
  });
  await page.getByRole("button", { name: "Ask" }).waitFor({ timeout: 90_000 });
  await sleep(3200);

  const remember = page.locator(".rail-remember");
  await punchClick(page, remember, { stay: true });
  const composer = page.locator(".memory-composer textarea");
  await composer.waitFor({ state: "visible" });
  await typeHuman(
    page,
    composer,
    "Gilly Zaid might pass through later this month. I should get dinner — no agenda.",
  );
  await zoomReset(page);
  await punchClick(page, page.getByRole("button", { name: "Structure into fields" }));
  const savePerson = page.getByRole("button", { name: "Save to person" });
  await savePerson.waitFor({ state: "visible", timeout: 60_000 });
  await sleep(900);
  await punchClick(page, savePerson);
  await sleep(2200);
}

async function encodeMp4(webm: string, mp4: string, narrationWav?: string | null) {
  const { spawnSync } = await import("node:child_process");
  if (narrationWav && existsSync(narrationWav)) {
    mixNarration(webm, narrationWav, mp4);
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

  const server = startDevServer();
  const stop = () => {
    server.kill("SIGTERM");
  };
  process.on("exit", stop);
  try {
    await waitForHttp(`${API}/api/health`);
    await waitForHttp(BASE);
    console.log("Recording…");

    const browser = await chromium.launch({
      headless: process.env.NETT_DEMO_HEADED === "1" ? false : true,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
      reducedMotion: "no-preference",
      recordVideo: { dir: RAW_DIR, size: { width: 1440, height: 900 } },
    });
    await context.addInitScript(OVERLAY);
    const page = await context.newPage();
    page.on("pageerror", (error) => console.warn("pageerror", error.message));

    try {
      await walkthrough(page);
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

    const narration = await trySynthesizeNarration(path.join(RAW_DIR, "narration.wav"));
    const mp4 = path.join(ARTIFACT_DIR, "nett-investor-demo.mp4");
    const repoCopy = path.join(RAW_DIR, "nett-investor-demo.mp4");
    await encodeMp4(webm, mp4, narration);
    writeFileSync(path.join(RAW_DIR, "source.webm.txt"), webm);
    copyFileSync(mp4, repoCopy);
    console.log(`Wrote ${mp4}`);
  } finally {
    stop();
    await sleep(400);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
