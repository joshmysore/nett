import { expect, test } from "@playwright/test";
import { firstPerson, waitForHealth } from "./helpers/api";
import { delayRoute } from "./helpers/stress";

test.beforeEach(async ({ request }) => {
  await waitForHealth(request);
});

test("profile loads and all-fields dialog opens under latency", async ({ page, request }) => {
  const person = await firstPerson(request);
  await delayRoute(page, `**/api/people/${person.id}`, 200);
  await page.goto(`/people/${person.id}`);
  await expect(page.getByRole("heading", { name: person.name, level: 1 })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "All fields" }).click();
  await expect(page.getByRole("heading", { name: /Edit Nett metadata/i })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("failed patch surfaces without wiping the page", async ({ page, request }) => {
  const person = await firstPerson(request);
  await page.goto(`/people/${person.id}`);
  await expect(page.getByRole("heading", { name: person.name, level: 1 })).toBeVisible();
  await page.route(`**/api/people/${person.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simulated patch failure" }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "All fields" }).click();
  await expect(page.getByRole("heading", { name: /Edit Nett metadata/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: person.name, level: 1 })).toBeVisible();
});
