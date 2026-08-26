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

test("/setup redirects to Ask", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Mutates shared onboarding; run on one project");
  await request.patch(`${api}/api/setup/onboarding`, {
    data: { phase: "you", ownerHometowns: [], ownerInterests: [] },
  });
  try {
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/today\/?$/);
    await expect(page.getByRole("heading", { name: "Ask Nett" })).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    await page.screenshot({ path: testInfo.outputPath("setup-redirect.png"), fullPage: true });
  } finally {
    await request.patch(`${api}/api/setup/onboarding`, { data: { complete: true } });
  }
});
