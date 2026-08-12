import { expect, test } from "@playwright/test";
import { waitForHealth } from "./helpers/api";
import { peopleSearch, rapidType } from "./helpers/stress";

test.beforeEach(async ({ request }) => {
  await waitForHealth(request);
});

test("URL search state survives reload and back", async ({ page }) => {
  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  const search = peopleSearch(page);
  await rapidType(page, search, "a");
  await expect(page).toHaveURL(/[?&]q=a(?:&|$)/i, { timeout: 10_000 });
  await page.reload();
  await expect(page).toHaveURL(/[?&]q=a(?:&|$)/i);
  const next = page.getByRole("button", { name: "Next" });
  if (await next.isEnabled()) {
    await next.click();
    await expect(page).toHaveURL(/page=2/);
    await page.goto("/people?q=a");
    await expect(page).toHaveURL(/[?&]q=a(?:&|$)/i);
  }
});

test("stale search response cannot win", async ({ page }) => {
  let releaseSlow: (() => void) | undefined;
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  let slowHandled = false;
  await page.route("**/api/people/page?**", async (route) => {
    const url = route.request().url();
    if (url.includes("q=aa") && !slowHandled) {
      slowHandled = true;
      await slowGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          people: [{ id: "stale", name: "Stale Result", preferred_name: "Stale Result", hometown: [], languages: [], skills: [], interests: [], foods: [], online_personality: [], institutions: [], mutuals: [], tags: [], sources: [], methods: [], memory_count: 0, interaction_count: 0, relationship_strength: 0, priority: 0, warmth: 0, intro_potential: 0, source_confidence: 0 }],
          total: 1,
          page: 1,
          limit: 50,
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/people");
  const search = peopleSearch(page);
  await search.fill("aa");
  await search.fill("alexander");
  releaseSlow?.();
  await page.waitForTimeout(400);
  await expect(page.locator(".person-glow-card").filter({ hasText: "Stale Result" })).toHaveCount(0);
});
