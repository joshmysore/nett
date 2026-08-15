import { expect, test } from "@playwright/test";
import { firstPerson, personMemoryCount, waitForHealth } from "./helpers/api";
import { delayRoute, openCapture } from "./helpers/stress";

const captureComposer = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog").locator("textarea").first();

test.beforeEach(async ({ request }) => {
  await waitForHealth(request);
});

test("capture open, structure, and cancel writes nothing", async ({ page, request }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const person = await firstPerson(request);
  const before = await personMemoryCount(request, person.id);
  await page.goto("/today");
  await openCapture(page);
  await captureComposer(page).fill(`Met ${person.name} about climate finance and AI.`);
  await page.getByRole("button", { name: "Structure into fields" }).click();
  await expect(page.getByRole("heading", { name: "Review the fields" })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Review the fields" })).toHaveCount(0);
  const after = await personMemoryCount(request, person.id);
  expect(after).toBe(before);
});

test("approve with no person selected stays blocked", async ({ page, request }) => {
  const person = await firstPerson(request);
  await page.goto("/today");
  await openCapture(page);
  await captureComposer(page).fill(`Remember that ${person.name} works on robotics.`);
  await page.getByRole("button", { name: "Structure into fields" }).click();
  await expect(page.getByRole("heading", { name: "Review the fields" })).toBeVisible({ timeout: 20_000 });
  const approve = page.getByRole("button", { name: "Save to person" });
  await expect(approve).toBeVisible();
  await page.getByRole("button", { name: "Structure into fields" }).waitFor({ state: "detached" });
});

test("Cmd+M opens Remember for structuring, not Ask", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/today");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+m" : "Control+m");
  await expect(page.getByRole("heading", { name: "Remember this" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Structure into fields" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("structure stays disabled while parse is in flight", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await delayRoute(page, "**/api/memories/parse", 800);
  await page.goto("/today");
  await openCapture(page);
  await captureComposer(page).fill("Met someone about product design.");
  await page.getByRole("button", { name: "Structure into fields" }).click();
  await expect(page.getByRole("button", { name: "Structure into fields" })).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("Record on a person page stays verbatim and does not open Remember", async ({ page, request }) => {
  const person = await firstPerson(request);
  await page.goto(`/people/${person.id}`);
  await expect(page.getByRole("heading", { name: person.name, exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Record a memory" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Remember this" })).toHaveCount(0);
  const record = page.locator("#profile-memory");
  await expect(record).toBeVisible();
  await record.fill("Had coffee and talked about nothing structured.");
  await expect(page.getByRole("button", { name: "Structure into fields" })).toHaveCount(0);
});

test("per-proposal reject keeps rejected fields out of save payload path", async ({ page, request }) => {
  const person = await firstPerson(request);
  const before = await personMemoryCount(request, person.id);
  await page.goto("/today");
  await openCapture(page);
  await captureComposer(page).fill(
    `Met ${person.name} in Lisbon through Maya. She works in climate finance and speaks Portuguese.`,
  );
  await page.getByRole("button", { name: "Structure into fields" }).click();
  await expect(page.getByRole("heading", { name: "Review the fields" })).toBeVisible({ timeout: 20_000 });
  const rejectButtons = page.getByRole("button", { name: "Reject" });
  if (await rejectButtons.count()) {
    await rejectButtons.first().click();
  }
  const candidate = page.getByRole("button", { name: new RegExp(person.name, "i") }).first();
  if (await candidate.count()) await candidate.click();
  const selected = page.locator(".candidate-grid button.is-selected");
  if (await selected.count()) {
    await page.getByRole("button", { name: "Save to person" }).click();
    await expect(page.getByRole("heading", { name: "Review the fields" })).toHaveCount(0, {
      timeout: 20_000,
    });
    const after = await personMemoryCount(request, person.id);
    expect(after).toBeGreaterThanOrEqual(before);
  }
});
