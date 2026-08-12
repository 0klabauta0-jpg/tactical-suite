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

  await dragFirstGroupToParent(page);
  await expect(page.getByTestId("scene-object-count")).toHaveText("0");
  await expect(page.getByTestId("rockbreaker-group-g1")).toHaveCount(0);
});
