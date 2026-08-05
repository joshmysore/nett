import { expect, test } from "@playwright/test";
import { firstPerson, waitForHealth } from "./helpers/api";

test.beforeEach(async ({ request }) => {
  await waitForHealth(request);
});

test("evidence check cancel mid-flight", async ({ page, request }) => {
  const person = await firstPerson(request);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/people/*/autofill**", async (route) => {
    await gate;
    await route.abort();
  });
  await page.goto(`/people/${person.id}`);
  await expect(page.getByRole("heading", { name: person.name, level: 1 })).toBeVisible();
  await page.getByText(/More about/i).click();
  const check = page.getByRole("button", { name: /Check evidence for gaps/i });
  await expect(check).toBeVisible();
  await check.click();
  const cancel = page.getByRole("button", { name: "Cancel" });
  if (await cancel.count()) await cancel.click();
  release?.();
  await expect(page.getByRole("heading", { name: person.name, level: 1 })).toBeVisible();
});

test("ollama-down style autofill error degrades", async ({ page, request }) => {
  const person = await firstPerson(request);
  await page.route("**/api/people/*/autofill**", async (route) => {
    const url = route.request().url();
    if (url.includes("generate=false")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          suggestions: [],
          degraded: true,
          note: "Local inference was unavailable.",
          model: null,
          provider: null,
          generatedAt: new Date().toISOString(),
          index: { documents: 0, indexedAt: null, stale: true, reason: "not-indexed" },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Local inference was unavailable" }),
    });
  });
  await page.goto(`/people/${person.id}`);
  await page.getByText(/More about/i).click();
  await page.getByRole("button", { name: /Check evidence for gaps/i }).click();
  await expect(page.getByText(/unavailable|No evidence|Suggestions/i).first()).toBeVisible({
    timeout: 15_000,
  });
});
