import { expect, test } from "@playwright/test";
import { firstPerson, waitForHealth } from "./helpers/api";
import { expectNoOverflow, openCapture } from "./helpers/stress";

test.beforeEach(async ({ request }) => {
  await waitForHealth(request);
});

for (const path of ["/", "/today", "/people"] as const) {
  test(`no overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expectNoOverflow(page);
  });
}

test("no overflow with capture open", async ({ page }) => {
  await page.goto("/today");
  await openCapture(page);
  await expectNoOverflow(page);
});

test("no overflow with person drawer/profile", async ({ page, request }) => {
  const person = await firstPerson(request);
  await page.goto(`/people/${person.id}`);
  await expect(page.getByRole("heading", { name: person.name, level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expectNoOverflow(page);
});
