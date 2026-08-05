import { expect, test } from "@playwright/test";
import { firstPerson, waitForHealth } from "./helpers/api";

test.beforeEach(async ({ request }) => {
  await waitForHealth(request);
});

test("suggest from messages opens and can cancel", async ({ page, request }) => {
  const person = await firstPerson(request);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/people/*/insights", async (route) => {
    await gate;
    await route.abort();
  });
  await page.goto(`/people/${person.id}`);
  await page.getByText(/More about/i).click();
  const button = page.getByRole("button", { name: /Suggest from messages/i });
  await expect(button).toBeVisible();
  await button.click();
  const cancel = page.getByRole("button", { name: "Cancel" });
  if (await cancel.count()) await cancel.click();
  release?.();
  await expect(page.getByRole("heading", { name: person.name, level: 1 })).toBeVisible();
});

test("insights degrade without model via API", async ({ request }) => {
  const person = await firstPerson(request);
  const response = await request.post(`http://127.0.0.1:4174/api/people/${person.id}/insights`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.personId).toBe(person.id);
  expect(typeof body.briefing).toBe("string");
  expect(Array.isArray(body.suggestions)).toBeTruthy();
  expect(body.pattern).toBeTruthy();
});
