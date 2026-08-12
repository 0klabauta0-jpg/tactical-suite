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

async function dragBy(
  page: import("@playwright/test").Page,
  source: import("@playwright/test").Locator,
  delta: { x: number; y: number },
) {
  const box = await source.boundingBox();
  if (!box) throw new Error("3D-Trupp ist nicht sichtbar.");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 24 });
  await page.mouse.up();
}

function coordinates(value: string | null) {
  const parts = (value ?? "").split("/").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) throw new Error(`Ungültige Koordinate: ${value}`);
  return { x: parts[0], y: parts[1], z: parts[2] };
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

test("moves a troop vertically in camera space and keeps it inside the shared field", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  const group = page.getByTestId("rockbreaker-group-g1").first();
  const before = coordinates(await page.getByTestId("camera-a-coordinate").textContent());

  await dragBy(page, group, { x: 0, y: -90 });

  await expect(page.getByTestId("scene-anchor")).toHaveText("freeSpace");
  const cameraA = await page.getByTestId("camera-a-coordinate").textContent();
  await expect(page.getByTestId("camera-b-coordinate")).toHaveText(cameraA ?? "");
  const elevated = coordinates(cameraA);
  expect(elevated.y).not.toBe(before.y);

  await dragBy(page, page.getByTestId("rockbreaker-group-g1").first(), { x: 2_000, y: 2_000 });
  const bounded = coordinates(await page.getByTestId("camera-a-coordinate").textContent());
  expect(bounded.x).toBeGreaterThanOrEqual(-36);
  expect(bounded.x).toBeLessThanOrEqual(37);
  expect(bounded.y).toBeGreaterThanOrEqual(-31);
  expect(bounded.y).toBeLessThanOrEqual(25);
  expect(bounded.z).toBeGreaterThanOrEqual(-23);
  expect(bounded.z).toBeLessThanOrEqual(29);
});
