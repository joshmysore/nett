import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = "docs/audits/final-screens";
mkdirSync(out, { recursive: true });

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone", width: 375, height: 812 },
  { name: "narrow", width: 320, height: 700 },
];

const routes = [
  ["dashboard", "/"],
  ["people", "/people"],
  ["connectors", "/settings/connectors"],
];

const browser = await chromium.launch();
const findings = [];

for (const scheme of ["light", "dark"]) {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: scheme,
    });
    const page = await context.newPage();
    for (const [name, url] of routes) {
      await page.goto(`http://127.0.0.1:5173${url}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const h1 = await page.locator("h1").first().textContent().catch(() => null);
      findings.push({ scheme, vp: vp.name, name, overflow, h1: h1?.trim() });
      if (vp.name === "desktop" || vp.name === "phone") {
        await page.screenshot({
          path: `${out}/${scheme}-${vp.name}-${name}.png`,
          fullPage: false,
        });
      }
    }

    // People keyboard + drawer
    if (vp.name === "desktop") {
      await page.goto("http://127.0.0.1:5173/people", { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      await page.keyboard.press("/");
      await page.keyboard.type("mysore", { delay: 20 });
      await page.waitForTimeout(400);
      const searchOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      findings.push({ scheme, vp: vp.name, name: "people-search", overflow: searchOverflow });

      await page.keyboard.press("Meta+m");
      await page.waitForTimeout(300);
      const captureOpen = await page.getByRole("dialog").count();
      findings.push({ scheme, vp: vp.name, name: "capture-shortcut", dialogs: captureOpen });
      if (captureOpen) await page.keyboard.press("Escape");
    }

    await context.close();
  }
}

await browser.close();
const bad = findings.filter((f) => (f.overflow ?? 0) > 0);
console.log(JSON.stringify({ findings, overflowFailures: bad }, null, 2));
if (bad.length) process.exit(1);
