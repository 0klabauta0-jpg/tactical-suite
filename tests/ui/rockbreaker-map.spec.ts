import { expect, test } from "@playwright/test";

async function waitForRockbreakerScene(page: import("@playwright/test").Page) {
  await expect(page.getByLabel("Rockbreaker 3D Karte").first()).toHaveAttribute("data-scene-ready", "true");
}

async function dragFirstGroupToParent(page: import("@playwright/test").Page) {
  await waitForRockbreakerScene(page);
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
  await waitForRockbreakerScene(page);
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

async function drawBentStroke(page: import("@playwright/test").Page, expectedStrokeCount = "1") {
  await waitForRockbreakerScene(page);
  await page.getByRole("button", { name: "Freihand zeichnen" }).first().click();
  const box = await page.getByLabel("Rockbreaker 3D Karte").first().boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  const path = [
    { x: box.x + 290, y: box.y + 220 },
    { x: box.x + 350, y: box.y + 170 },
    { x: box.x + 415, y: box.y + 235 },
  ];
  await page.mouse.move(path[0].x, path[0].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x, path[1].y, { steps: 16 });
  await page.mouse.move(path[2].x, path[2].y, { steps: 16 });
  await page.mouse.up();
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText(expectedStrokeCount);
  return { box, path };
}

const readPoints = async (page: import("@playwright/test").Page) => JSON.parse(
  await page.getByTestId("camera-a-stroke-points").textContent() ?? "[]",
) as Array<[number, number, number]>;

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

test("draws one shared freehand 3d path", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await waitForRockbreakerScene(page);
  await page.getByRole("button", { name: "Freihand zeichnen" }).first().click();
  const canvas = page.getByLabel("Rockbreaker 3D Karte").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  await page.mouse.move(box.x + 300, box.y + 240);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 190, { steps: 12 });
  await page.mouse.move(box.x + 410, box.y + 250, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
  await expect(page.getByTestId("camera-a-stroke-points")).toHaveText(await page.getByTestId("camera-b-stroke-points").textContent() ?? "");
  const stored = await page.getByTestId("camera-a-stroke-points").textContent();
  await page.getByRole("button", { name: "Kamera A drehen" }).click();
  await expect(page.getByTestId("camera-a-stroke-points")).toHaveText(stored ?? "");
  await expect(page.getByTestId("camera-b-stroke-points")).toHaveText(stored ?? "");
});

test("removes a failed local preview without creating shared state", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?drawingCreateFailure=1");
  await waitForRockbreakerScene(page);
  await page.getByRole("button", { name: "Freihand zeichnen" }).first().click();
  const box = await page.getByLabel("Rockbreaker 3D Karte").first().boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  await page.mouse.move(box.x + 300, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 180, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("0");
  await expect(page.getByTestId("rockbreaker-preview-count")).toHaveText("0");
  await expect(page.getByTestId("drawing-status")).toContainText("konnte nicht gespeichert werden");
});

test("creates one shared point only when the click is released", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await waitForRockbreakerScene(page);
  await page.getByRole("button", { name: "Punkt setzen" }).first().click();
  const box = await page.getByLabel("Rockbreaker 3D Karte").first().boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  await page.mouse.move(box.x + 320, box.y + 230);
  await page.mouse.down();
  await expect(page.getByTestId("scene-object-count")).toHaveText("2");
  await page.mouse.up();
  await expect(page.getByTestId("scene-object-count")).toHaveText("3");
});

test("shows persistent Rockbreaker drawing controls to writers", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await expect(page.getByRole("button", { name: "Freihand zeichnen" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Freihand zeichnen" }).first().click();
  await expect(page.getByRole("button", { name: "Freihand zeichnen" }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Strichstärke 3" }).first()).toBeVisible();
});

test("moves the complete stroke in xyz without changing its shape", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  const { path } = await drawBentStroke(page);
  const before = await readPoints(page);
  await page.getByRole("button", { name: "Zeichnung verschieben" }).first().click();
  await page.mouse.move(path[1].x, path[1].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x + 80, path[1].y - 70, { steps: 20 });
  await page.mouse.up();
  const after = await readPoints(page);
  const deltas = after.map((point, index) => point.map((value, axis) => value - before[index][axis]));
  expect(deltas.every((delta) => delta.every((value, axis) => Math.abs(value - deltas[0][axis]) < 0.001))).toBe(true);
  expect(deltas[0].every((value) => Math.abs(value) > 0.01)).toBe(true);
  const segment = (points: Array<[number, number, number]>, index: number) =>
    points[index + 1].map((value, axis) => value - points[index][axis]);
  const sameVector = (left: number[], right: number[]) => left.every((value, axis) => Math.abs(value - right[axis]) < 0.001);
  expect(sameVector(segment(after, 0), segment(before, 0))).toBe(true);
  expect(sameVector(segment(after, before.length - 2), segment(before, before.length - 2))).toBe(true);
  const movedScreen = { x: path[1].x + 80, y: path[1].y - 70 };
  await page.mouse.move(movedScreen.x, movedScreen.y);
  await page.mouse.down();
  await page.mouse.move(movedScreen.x + 2_000, movedScreen.y + 2_000, { steps: 24 });
  await page.mouse.up();
  const bounded = await readPoints(page);
  expect(bounded.every(([x, y, z]) => x >= -36 && x <= 37 && y >= -31 && y <= 25 && z >= -23 && z <= 29)).toBe(true);
});

test("moves one drawing point in xyz", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await waitForRockbreakerScene(page);
  const box = await page.getByLabel("Rockbreaker 3D Karte").first().boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  const start = { x: box.x + 470, y: box.y + 250 };
  await page.getByRole("button", { name: "Punkt setzen" }).first().click();
  await page.mouse.click(start.x, start.y);
  const before = coordinates(await page.getByTestId("drawing-point-coordinate").textContent());
  await page.getByRole("button", { name: "Zeichnung verschieben" }).first().click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y - 60, { steps: 20 });
  await page.mouse.up();
  const after = coordinates(await page.getByTestId("drawing-point-coordinate").textContent());
  expect(after.x).not.toBe(before.x);
  expect(after.y).not.toBe(before.y);
  expect(after.z).not.toBe(before.z);
});

test("deletes a selected point and stroke but never a troop", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  const { box, path } = await drawBentStroke(page);
  await page.getByRole("button", { name: "Punkt setzen" }).first().click();
  await page.mouse.click(box.x + 480, box.y + 260);
  await expect(page.getByTestId("rockbreaker-point-count")).toHaveText("1");
  await page.getByRole("button", { name: "Zeichnung löschen" }).first().click();
  await page.mouse.click(path[1].x, path[1].y);
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("0");
  await page.mouse.click(box.x + 480, box.y + 260);
  await expect(page.getByTestId("rockbreaker-point-count")).toHaveText("0");
  const troop = await page.getByTestId("rockbreaker-group-g1").first().boundingBox();
  if (!troop) throw new Error("Trupp fehlt.");
  await page.mouse.click(troop.x + troop.width / 2, troop.y + troop.height / 2);
  await expect(page.getByTestId("rockbreaker-group-g1")).toHaveCount(2);
});

test("undo removes only the current user's latest drawing", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?foreignStroke=1");
  const { box } = await drawBentStroke(page, "2");
  await page.getByRole("button", { name: "Punkt setzen" }).first().click();
  await page.mouse.click(box.x + 470, box.y + 250);
  await page.getByRole("button", { name: "Eigene letzte Zeichnung rückgängig" }).first().click();
  await expect(page.getByTestId("rockbreaker-point-count")).toHaveText("0");
  await page.getByRole("button", { name: "Eigene letzte Zeichnung rückgängig" }).first().click();
  await expect(page.getByTestId("foreign-stroke-count")).toHaveText("1");
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
});

test("moves an enemy marker freely in xyz and remains bounded", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?emptyEnemy=1");
  await waitForRockbreakerScene(page);
  const box = await page.getByLabel("Rockbreaker 3D Karte").first().boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  const start = { x: box.x + 430, y: box.y + 230 };
  await page.getByRole("button", { name: "Boden-Feindmarker setzen" }).click();
  await page.mouse.click(start.x, start.y);
  const before = coordinates(await page.getByTestId("enemy-coordinate").textContent());
  await page.getByRole("button", { name: "Zeiger" }).first().click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 90, { steps: 20 });
  await page.mouse.up();
  const after = coordinates(await page.getByTestId("enemy-coordinate").textContent());
  expect(after.y).not.toBe(before.y);
  expect(after.x).toBeGreaterThanOrEqual(-36); expect(after.x).toBeLessThanOrEqual(37);
  expect(after.y).toBeGreaterThanOrEqual(-31); expect(after.y).toBeLessThanOrEqual(25);
  expect(after.z).toBeGreaterThanOrEqual(-23); expect(after.z).toBeLessThanOrEqual(29);
});

test("rolls a drawing back after a revision conflict", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?drawingConflict=1");
  const { path } = await drawBentStroke(page);
  const confirmed = await page.getByTestId("camera-a-stroke-points").textContent();
  await page.getByRole("button", { name: "Zeichnung verschieben" }).first().click();
  await page.mouse.move(path[1].x, path[1].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x + 60, path[1].y - 60, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByTestId("camera-a-stroke-points")).toHaveText(confirmed ?? "");
  await expect(page.getByTestId("drawing-status")).toContainText("Positionskonflikt");
});

test("keeps a drawing visible when deletion fails", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?drawingDeleteFailure=1");
  const { path } = await drawBentStroke(page);
  await page.getByRole("button", { name: "Zeichnung löschen" }).first().click();
  await page.mouse.click(path[1].x, path[1].y);
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
  await expect(page.getByTestId("drawing-status")).toContainText("konnte nicht gelöscht werden");
});

test("viewer sees shared paths without drawing controls", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?viewer=1");
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Freihand zeichnen" })).toHaveCount(0);
});

test("foreground troop and enemy do not block moving or deleting a drawing", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?overlapDrawing=1");
  const { path } = await drawBentStroke(page);
  await expect(page.getByTestId("overlap-ready")).toHaveText("1");
  const before = await page.getByTestId("camera-a-stroke-points").textContent();
  await page.getByRole("button", { name: "Zeichnung verschieben" }).first().click();
  await page.mouse.move(path[1].x, path[1].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x + 55, path[1].y - 45, { steps: 16 });
  await page.mouse.up();
  await expect(page.getByTestId("camera-a-stroke-points")).not.toHaveText(before ?? "");
  await page.getByRole("button", { name: "Zeichnung löschen" }).first().click();
  await page.mouse.click(path[1].x + 55, path[1].y - 45);
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("0");
  await expect(page.getByTestId("rockbreaker-group-g1")).toHaveCount(2);
  await expect(page.getByTestId("rockbreaker-enemy-count")).toHaveText("1");
});

test("ignores foreign pointers and keeps one preview owned by its first pointer", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await waitForRockbreakerScene(page);
  await page.getByRole("button", { name: "Freihand zeichnen" }).first().click();
  const canvas = page.getByLabel("Rockbreaker 3D Karte").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  await page.mouse.move(box.x + 280, box.y + 220);
  await page.mouse.down();
  await expect(page.getByTestId("rockbreaker-preview-count")).toHaveText("1");
  const dispatchForeign = (type: string, x: number, y: number) => canvas.evaluate((element, detail) => {
    element.dispatchEvent(new PointerEvent(detail.type, {
      pointerId: 22, pointerType: "touch", clientX: detail.x, clientY: detail.y,
      buttons: detail.type === "pointerup" ? 0 : 1, bubbles: true,
    }));
  }, { type, x, y });
  await dispatchForeign("pointerdown", box.x + 360, box.y + 180);
  await dispatchForeign("pointermove", box.x + 410, box.y + 150);
  await dispatchForeign("pointerup", box.x + 410, box.y + 150);
  await expect(page.getByTestId("rockbreaker-preview-count")).toHaveText("1");
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("0");
  await page.mouse.move(box.x + 350, box.y + 170, { steps: 10 });
  await page.mouse.move(box.x + 410, box.y + 230, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("rockbreaker-preview-count")).toHaveText("0");
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
});

test("authoritative object update cancels an active drag without a stale write", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  const { path } = await drawBentStroke(page);
  await page.getByRole("button", { name: "Zeichnung verschieben" }).first().click();
  await page.mouse.move(path[1].x, path[1].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x + 45, path[1].y - 35, { steps: 12 });
  await page.getByTestId("authoritative-scene-update").evaluate((button: HTMLButtonElement) => button.click());
  await page.mouse.move(path[1].x + 80, path[1].y - 65, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("scene-translation-count")).toHaveText("0");
  await expect(page.getByTestId("rockbreaker-preview-count")).toHaveText("0");
});

test("rejects a stroke release in the same turn as an authoritative render", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  const { path } = await drawBentStroke(page);
  const authoritative = await page.getByTestId("camera-a-stroke-points").textContent();
  await page.getByRole("button", { name: "Zeichnung verschieben" }).first().click();
  await page.mouse.move(path[1].x, path[1].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x + 45, path[1].y - 35, { steps: 12 });
  await page.getByTestId("authoritative-update-and-release").evaluate((button: HTMLButtonElement) => button.click());
  await page.mouse.up();
  await expect(page.getByTestId("scene-translation-count")).toHaveText("0");
  await expect(page.getByTestId("camera-a-stroke-points")).toHaveText(authoritative ?? "");
});
