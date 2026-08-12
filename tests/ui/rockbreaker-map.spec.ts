import { expect, test } from "@playwright/test";

test("two cameras render one shared world coordinate", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await expect(page.getByLabel("Rockbreaker 3D Karte")).toHaveCount(2);
  await page.getByRole("button", { name: "Objekt auf 4 / 2 / -3 setzen" }).click();
  await expect(page.getByTestId("camera-a-coordinate")).toHaveText("4.00 / 2.00 / -3.00");
  await expect(page.getByTestId("camera-b-coordinate")).toHaveText("4.00 / 2.00 / -3.00");
  await page.getByRole("button", { name: "Kamera A drehen" }).click();
  await expect(page.getByTestId("camera-b-coordinate")).toHaveText("4.00 / 2.00 / -3.00");
  await expect(page.getByText("Grid sichtbar · Truppe 1")).toBeVisible();
});
