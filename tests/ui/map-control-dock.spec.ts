import { expect, test } from "@playwright/test";

test("keeps map controls in one compact collapsible right dock", async ({ page }) => {
  await page.goto("/ui-test/map-controls");
  const dock = page.getByRole("complementary", { name: "Kartensteuerung" });
  await expect(dock).toBeVisible();
  await expect(dock).toHaveCSS("right", "0px");
  await expect(page.getByRole("button", { name: "Grid ausschalten" })).toBeVisible();
  await expect(page.getByText("Karten-Testinhalt")).toBeHidden();
  await expect(page.getByText("Token-Testinhalt")).toBeHidden();
  await expect(page.getByText("Feindmarker-Testinhalt")).toBeHidden();
  await expect(page.getByText("Zeichen-Testinhalt")).toBeHidden();

  await page.getByRole("button", { name: "Tokenbereich ausklappen" }).click();
  await expect(page.getByText("Token-Testinhalt")).toBeVisible();

  await page.getByRole("button", { name: "Steuerleiste einklappen" }).click();
  await expect(dock).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("button", { name: "Steuerleiste ausklappen" }).click();
  await expect(dock).toHaveAttribute("data-collapsed", "false");
});
