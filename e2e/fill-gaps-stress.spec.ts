import { expect, test } from "@playwright/test";
import { waitForHealth } from "./helpers/api";
import { abortRoute } from "./helpers/stress";

test.beforeEach(async ({ request }) => {
  await waitForHealth(request);
});

test("fill gaps opens, field change works, abort does not crash", async ({ page }) => {
  await page.goto("/people?missing=industry");
  await page.getByRole("button", { name: /Fill gaps/i }).click();
  await expect(page.getByRole("heading", { name: "Fill gaps" })).toBeVisible();
  const select = page.locator("select").first();
  await expect(select).toBeVisible();
  const options = await select.locator("option").allTextContents();
  expect(options.length).toBeGreaterThan(1);
  // Prefer tags if present.
  const tagsOption = options.find((label) => /categor/i.test(label) || /tag/i.test(label));
  if (tagsOption) {
    await select.selectOption({ label: tagsOption });
  } else {
    await select.selectOption({ index: 1 });
  }
  await abortRoute(page, "**/api/people/*/autofill**");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Fill gaps" })).toHaveCount(0);
});
