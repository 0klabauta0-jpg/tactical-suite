import { expect, test } from "@playwright/test";

test("keeps map controls in one collapsible left dock", async ({ page }) => {
  await page.goto("/ui-test/map-controls");
  const dock = page.getByRole("complementary", { name: "Kartensteuerung" });
  await expect(dock).toBeVisible();
  await expect(page.getByRole("button", { name: "Grid ausschalten" })).toBeVisible();
  await expect(page.getByText("Karten-Testinhalt")).toBeVisible();
  await expect(page.getByText("Token-Testinhalt")).toBeVisible();
  await expect(page.getByText("Zeichen-Testinhalt")).toBeVisible();

  await page.getByRole("button", { name: "Tokenbereich einklappen" }).click();
  await expect(page.getByText("Token-Testinhalt")).toBeHidden();

  await page.getByRole("button", { name: "Steuerleiste einklappen" }).click();
  await expect(dock).toHaveAttribute("data-collapsed", "true");
});
