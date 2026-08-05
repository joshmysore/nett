import { expect, test } from "@playwright/test";
import { waitForHealth } from "./helpers/api";
import { expectFocusTrapped, openCapture } from "./helpers/stress";

test.beforeEach(async ({ request }) => {
  await waitForHealth(request);
});

test("capture modal traps focus and Escape closes only the modal", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await openCapture(page);
  await expectFocusTrapped(page, /Remember this|Review the memory/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("fill gaps modal opens and traps focus", async ({ page }) => {
  await page.goto("/people");
  const fill = page.getByRole("button", { name: /Fill gaps/i });
  await expect(fill).toBeVisible();
  await fill.click();
  await expect(page.getByRole("heading", { name: "Fill gaps" })).toBeVisible();
  await expectFocusTrapped(page, "Fill gaps");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Fill gaps" })).toHaveCount(0);
});
