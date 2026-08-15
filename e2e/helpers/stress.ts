import { expect, type Page, type Route } from "@playwright/test";

export async function delayRoute(page: Page, url: string | RegExp, delayMs: number) {
  await page.route(url, async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
}

export async function abortRoute(page: Page, url: string | RegExp) {
  await page.route(url, (route) => route.abort());
}

export async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

export async function expectFocusTrapped(page: Page, dialogName: string | RegExp) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  const inside = await page.evaluate(() => {
    const active = document.activeElement;
    const root = active?.closest("[role='dialog']");
    return Boolean(root);
  });
  expect(inside).toBe(true);
}

export async function rapidType(page: Page, locator: ReturnType<Page["locator"]>, text: string) {
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(text, { delay: 20 });
}

export async function openCapture(page: Page) {
  const remember = page.getByRole("button", { name: /Remember/i }).first();
  if (await remember.count()) {
    await remember.click();
  } else {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+m" : "Control+m");
  }
  await expect(page.getByRole("heading", { name: /Remember this|Review the fields/ })).toBeVisible({
    timeout: 10_000,
  });
}

export function peopleSearch(page: Page) {
  return page.getByLabel("Search people").or(page.getByPlaceholder(/Name, company, memory/i)).first();
}
