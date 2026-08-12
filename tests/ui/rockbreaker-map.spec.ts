import { expect, test } from "@playwright/test";

async function dragFirstGroupToParent(page: import("@playwright/test").Page) {
  const source = await page.getByTestId("rockbreaker-group-g1").first().boundingBox();
  const target = await page.getByTestId("rockbreaker-move-up").first().boundingBox();
  if (!source || !target) throw new Error("3D-Trupp oder Rückweg ist nicht sichtbar.");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
  await page.mouse.up();
}

async function dragTroop(
  page: import("@playwright/test").Page,
  sourceTestId: string,
  targetTestId: string,
) {
  const source = await page.getByTestId(sourceTestId).boundingBox();
  const target = await page.getByTestId(targetTestId).boundingBox();
  if (!source || !target) throw new Error("Trupp oder 3D-Ziel ist nicht sichtbar.");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
  await page.mouse.up();
}

test("two cameras render one shared world coordinate", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await expect(page.getByLabel("Rockbreaker 3D Karte")).toHaveCount(2);
  await expect(page.getByLabel("Truppenmarker")).toHaveCount(0);
  await expect(page.getByTestId("rockbreaker-move-up")).toHaveCount(2);
  await expect(page.getByText("↑ Eine Ebene hoch nach Nyx")).toHaveCount(2);
  await page.getByRole("button", { name: "Objekt auf 4 / 2 / -3 setzen" }).click();
  await expect(page.getByTestId("camera-a-coordinate")).toHaveText("4.00 / 2.00 / -3.00");
  await expect(page.getByTestId("camera-b-coordinate")).toHaveText("4.00 / 2.00 / -3.00");
  await page.getByRole("button", { name: "Kamera A drehen" }).click();
  await expect(page.getByTestId("camera-b-coordinate")).toHaveText("4.00 / 2.00 / -3.00");
  await expect(page.getByTestId("scene-anchor")).toHaveText("beltPlane");
  await expect(page.getByText("Grid sichtbar · Fight Team")).toBeVisible();

  await expect(page.getByTestId("rockbreaker-enemy-count")).toHaveText("1");
  await page.getByRole("button", { name: "3D-Zeit ein Jahr vorspulen" }).click();
  await expect(page.getByTestId("rockbreaker-enemy-count")).toHaveText("1");
  await page.getByRole("button", { name: "3D-Feindmarker löschen" }).click();
  await expect(page.getByTestId("rockbreaker-enemy-count")).toHaveText("0");

  await dragFirstGroupToParent(page);
  await expect(page.getByTestId("scene-object-count")).toHaveText("0");
  await expect(page.getByTestId("rockbreaker-group-g1")).toHaveCount(0);
});

test("accepts a listed Nyx troop and lets the return target navigate without moving it", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");

  await dragTroop(page, "troop-chip-g2", "rockbreaker-scene-drop-a");
  await expect(page.getByTestId("rockbreaker-group-g2").first()).toBeVisible();
  await expect(page.getByTestId("scene-object-count")).toHaveText("3");

  await page.getByRole("button", { name: "Eine Ebene hoch nach Nyx" }).first().click();
  await expect(page.getByTestId("rockbreaker-navigation-count")).toHaveText("1");
  await expect(page.getByTestId("scene-object-count")).toHaveText("3");
});
