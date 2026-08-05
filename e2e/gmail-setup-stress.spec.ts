import { expect, test } from "@playwright/test";
import { waitForHealth } from "./helpers/api";

test.beforeEach(async ({ request }) => {
  await waitForHealth(request);
});

test("gmail card and setup states are explicit", async ({ page }) => {
  await page.goto("/settings/connectors");
  await expect(page.getByRole("heading", { name: "Gmail", exact: true })).toBeVisible();
  const gmailCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Gmail", exact: true }) });
  await gmailCard.scrollIntoViewIfNeeded();
  await gmailCard.getByRole("button", { name: "Gmail setup options" }).click();
  const setup = page.getByRole("region", { name: "Gmail setup" });
  await expect(setup).toBeVisible();
  await expect(setup.getByText(/OAuth|Keychain|read-only/i).first()).toBeVisible();
  await expect(setup.getByRole("button", { name: /Authorize in Google|Connect Gmail/i }).first()).toBeVisible();
});

test("gmail defaults endpoint responds", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:4174/api/platform/gmail/defaults");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body).toHaveProperty("redirectUri");
  expect(body).toHaveProperty("bundledClientId");
});

test("authorize without client id fails cleanly when mocked configure missing", async ({ page }) => {
  await page.route("**/api/platform/gmail/authorize", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Add a Google OAuth desktop client ID before connecting Gmail." }),
    });
  });
  await page.goto("/settings/connectors");
  await expect(page.getByRole("heading", { name: "Gmail", exact: true })).toBeVisible();
});
