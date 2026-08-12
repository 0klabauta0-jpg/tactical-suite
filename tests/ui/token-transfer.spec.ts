import { expect, test, type Page } from "@playwright/test";

async function dragTroop(
  page: Page,
  sourceTestId: string,
  targetTestId: string,
) {
  const source = await page.getByTestId(sourceTestId).boundingBox();
  const target = await page.getByTestId(targetTestId).boundingBox();
  if (!source || !target) throw new Error("Drag-Quelle oder -Ziel ist nicht sichtbar.");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 });
  await page.mouse.up();
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  // DndKit removes its document-level pointer sensor just after the drop render.
  await page.waitForTimeout(100);
}

test("drags a troop into a child and returns it exactly one level", async ({ page }) => {
  await page.goto("/ui-test/token-transfer");

  await dragTroop(page, "troop-chip-g1", "location-pill-cap-map");
  await expect(page.getByTestId("last-transfer-intent")).toHaveText('{"kind":"enterChild","childId":"cap-map"}');
  await expect(page.getByTestId("location-pill-cap-map")).toContainText("Fight Team");
  await expect(page.getByTestId("token-main-g1")).toHaveCount(0);

  await page.getByTestId("location-pill-cap-map").getByRole("button").press("Enter");
  await expect(page.getByTestId("token-cap-map-g1")).toBeVisible();

  await dragTroop(page, "token-cap-map-g1", "move-up-target");
  await expect(page.getByTestId("token-main-g1")).toBeVisible();
});

test("rolls an optimistic move back after a transfer conflict", async ({ page }) => {
  await page.goto("/ui-test/token-transfer?conflict=1");

  await dragTroop(page, "troop-chip-g1", "location-pill-cap-map");

  await expect(page.getByTestId("token-main-g1")).toBeVisible();
  await expect(page.getByTestId("transfer-status")).toContainText(
    "Trupp wurde inzwischen von einem anderen Teilnehmer verschoben.",
  );
});

test("prefers the Rockbreaker pill when a map token overlaps it", async ({ page }) => {
  await page.goto("/ui-test/token-transfer");

  await dragTroop(page, "manual-map-token", "location-pill-rockbreaker");

  await expect(page.getByTestId("manual-transfer-intent"))
    .toHaveText('{"kind":"enterChild","childId":"rockbreaker"}');
});
