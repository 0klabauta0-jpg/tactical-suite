import { expect, test } from "@playwright/test";

test("shows clear feedback for a room without configuration", async ({ page }) => {
  const roomId = `ui-regression-missing-${crypto.randomUUID()}`;

  await page.goto(`/?room=${roomId}`);

  await expect(page.getByText("Dieser Raum hat noch keine Konfiguration.")).toBeVisible();
  await expect(page.getByText(`rooms/${roomId}/config/main`)).toBeVisible();

  await page.getByRole("button", { name: "Konfiguration prüfen" }).click();
  await expect(page.getByText("Keine Raum-Konfiguration gefunden.")).toBeVisible();
});
