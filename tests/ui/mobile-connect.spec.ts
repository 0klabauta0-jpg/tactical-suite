import { expect, test } from "@playwright/test";

test("removes the QR secret before opening the mobile status page", async ({ page }) => {
  await page.route("**/api/mobile/connect", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toEqual({ roomId: "room", playerId: "p1", token: "a".repeat(43) });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ redirectTo: "/mobile/status" }) });
  });
  await page.route("**/mobile/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<h1>Persönlicher Status</h1>" });
  });

  await page.goto(`/connect#r=room&p=p1&t=${"a".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "Persönlicher Status" })).toBeVisible();
  expect(page.url()).toBe("http://127.0.0.1:4174/mobile/status");
  expect(await page.evaluate(() => history.length)).toBeGreaterThan(0);
});
