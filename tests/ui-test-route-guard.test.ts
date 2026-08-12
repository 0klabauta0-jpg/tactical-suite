import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const previous = process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES;

afterEach(() => {
  if (previous === undefined) delete process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES;
  else process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES = previous;
});

describe("UI test route proxy", () => {
  it("returns a real 404 when UI test routes are disabled", () => {
    delete process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES;
    expect(proxy().status).toBe(404);
  });

  it("lets the dedicated UI test build continue", () => {
    process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES = "1";
    const response = proxy();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
