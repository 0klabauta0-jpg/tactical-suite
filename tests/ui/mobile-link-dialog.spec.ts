import { expect, test } from "@playwright/test";

test("shows a personal renewable QR code", async ({ page }) => {
  await page.goto("/ui-test/mobile-link");
  await expect(page.getByRole("heading", { name: "Handy verbinden" })).toBeVisible();
  await expect(page.getByText("KRT Ada")).toBeVisible();
  const qr = page.getByRole("img", { name: "Persönlicher KlabsCom QR-Code" });
  await expect(qr).toBeVisible();
  const firstSource = await qr.getAttribute("src");

  await page.getByRole("button", { name: "Verbindung erneuern" }).click();
  await expect(qr).not.toHaveAttribute("src", firstSource ?? "");
  await expect(page.getByText(/Gültig bis/)).toBeVisible();
});
