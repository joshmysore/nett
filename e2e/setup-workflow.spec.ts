import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const api = "http://127.0.0.1:4174";

async function expectNoSeriousAccessibilityViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical"
  );
  expect(serious, serious.map((violation) =>
    `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`
  ).join("\n")).toEqual([]);
}

test("owner-preview extracts hometowns and interests without writing", async ({ request }) => {
  const response = await request.post(`${api}/api/setup/owner-preview`, {
    data: { transcript: "I grew up in Dallas and Austin. I'm into climbing and climate." },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { hometowns: string[]; interests: string[] };
  expect(body.hometowns).toEqual(["Dallas", "Austin"]);
  expect(body.interests).toEqual(["climbing", "climate"]);
});

test("setup you and conversations stages are the first-run path", async ({ page, request }, testInfo) => {
  await request.patch(`${api}/api/setup/onboarding`, { data: { phase: "you" } });
  try {
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: /Hometowns and interests are enough/i })).toBeVisible();
    const hometowns = page.getByLabel("Hometowns");
    await hometowns.fill("Dallas");
    await hometowns.press("Enter");
    await expect(page.getByRole("button", { name: "Remove Dallas" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: /Start with Apple Contacts/i })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("heading", { name: /Connect Messages, WhatsApp, and Gmail/i })).toBeVisible();
    await expect(page.getByText("Messages", { exact: true })).toBeVisible();
    await expect(page.getByText("WhatsApp", { exact: true })).toBeVisible();
    await expect(page.getByText("Gmail", { exact: true })).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    await page.screenshot({ path: testInfo.outputPath("setup-conversations.png"), fullPage: true });
  } finally {
    await request.patch(`${api}/api/setup/onboarding`, { data: { complete: true } });
  }
});
