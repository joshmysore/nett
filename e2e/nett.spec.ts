import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

test("dashboard, command search, and accessibility", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Relationship desk" })).toBeVisible();
  await expect(page.getByText("Local intelligence", { exact: true })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole("button", { name: /Search people/ }).click();
  const search = page.getByRole("combobox", { name: "Search your network" });
  await expect(search).toBeVisible();
  await search.fill("Alex");
  await expect(page.locator(".command-results > button").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });
});

test("server-paginated people and evidence profile", async ({ page, request }, testInfo) => {
  const response = await request.get("http://127.0.0.1:4174/api/people/page?page=1&limit=1");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { people: Array<{ id: string; name: string }>; total: number };
  expect(payload.total).toBeGreaterThan(1_000);

  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "Find anyone without scanning." })).toBeVisible();
  await expect(page.locator(".person-row")).toHaveCount(50);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".person-row")).toHaveCount(50);
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath("people.png"), fullPage: true });

  const person = payload.people[0];
  await page.goto(`/people/${person.id}`);
  await expect(page.getByRole("heading", { name: person.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Relationship pulse" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chronological record" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: "Edit fields" }).click();
  await expect(page.getByRole("heading", { name: "Edit Nett metadata" })).toBeVisible();
  await expect(page.getByText("Public profile assist", { exact: true })).toBeVisible();
  await page.getByLabel("Public profile URL").fill(`https://www.linkedin.com/in/nett-e2e-${Date.now()}`);
  await page.getByLabel("Visible public profile text").fill(
    `${person.name}\nResearch Director at Example Institute\nGreater New York City Area`
  );
  await page.getByRole("button", { name: "Preview facts" }).click();
  await expect(page.getByRole("button", { name: /Stage selected facts/ })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("connector setup states are explicit and local", async ({ page }, testInfo) => {
  await page.goto("/settings/connectors");
  await expect(page.getByRole("heading", { name: "Control what Nett can read." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Local relationship intelligence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gmail", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Telegram", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "WhatsApp history", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "LinkedIn public profile assist", exact: true })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath("connectors.png"), fullPage: true });
});

test("mobile navigation and primary actions fit the viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only viewport check");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Relationship desk" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("complementary", { name: "Primary navigation" })).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("mobile-dashboard.png"), fullPage: true });
});
