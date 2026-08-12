import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("shows the verified player and supports death and respawn", async ({ page }) => {
  await page.goto("/ui-test/mobile-status");
  await expect(page.getByRole("heading", { name: "KRT Ada" })).toBeVisible();
  await expect(page.getByText("Operation Nyx")).toBeVisible();
  await expect(page.getByText("Persönlich verbunden")).toBeVisible();

  await page.getByRole("button", { name: "TOT" }).click();
  await expect(page.getByText("Aktuell: TOT")).toBeVisible();

  await page.getByLabel("Spawnpunkt").selectOption("spawn-2");
  await page.getByRole("button", { name: "RESPAWN" }).click();
  await expect(page.getByText("Aktuell: LEBT")).toBeVisible();
  await expect(page.getByText("Weitere Schnellaktionen")).toBeVisible();
});
