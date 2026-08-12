import { expect, test } from "@playwright/test";

test("shows clear feedback for a room without configuration", async ({ page }) => {
  const roomId = `ui-regression-missing-${crypto.randomUUID()}`;
  await page.route("https://firestore.googleapis.com/**", async (route) => {
    await route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  });

  await page.goto(`/?room=${roomId}`);

  await expect(page.getByText("Dieser Raum hat noch keine Konfiguration.")).toBeVisible();
  await expect(page.getByText(/Ein Admin muss den Raum .* serverseitig einrichten/)).toBeVisible();

  await page.getByRole("button", { name: "Konfiguration prüfen" }).click();
  await expect(page.getByText("Keine Raum-Konfiguration gefunden.")).toBeVisible();
});
