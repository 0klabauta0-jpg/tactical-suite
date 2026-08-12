import { describe, expect, it } from "vitest";
import { createMobileConnectHandler } from "@/app/api/mobile/connect/route";
import { MobileLinkStoreError } from "@/lib/server/mobile-link-store";

describe("mobile connect route", () => {
  it("exchanges a valid token for a strict HttpOnly session cookie", async () => {
    const handler = createMobileConnectHandler({
      verifyLink: async () => ({ tokenHash: "hash", sessionRevision: 2, issuedAtMs: 1, expiresAtMs: 61_000 }),
      createSession: () => "signed-session",
      now: () => 1_000,
      environment: "production",
    });
    const response = await handler(new Request("https://app.example/api/mobile/connect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: "room", playerId: "p1", token: "a".repeat(43) }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectTo: "/mobile/status" });
    expect(response.headers.get("set-cookie")).toContain("klabscom_mobile=signed-session");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("returns one generic error for invalid and disabled links", async () => {
    for (const code of ["INVALID_LINK", "FEATURE_DISABLED"] as const) {
      const handler = createMobileConnectHandler({
        verifyLink: async () => { throw new MobileLinkStoreError(code); },
        createSession: () => "never", now: Date.now, environment: "test",
      });
      const response = await handler(new Request("https://app.example/api/mobile/connect", {
        method: "POST", body: JSON.stringify({ roomId: "room", playerId: "p1", token: "a".repeat(43) }),
      }));
      expect(response.status).toBe(code === "FEATURE_DISABLED" ? 404 : 401);
      expect(await response.json()).toEqual({ error: "Verbindung ungültig oder widerrufen." });
    }
  });

  it("rejects malformed connection material before verification", async () => {
    let verified = false;
    const handler = createMobileConnectHandler({
      verifyLink: async () => { verified = true; throw new Error("unexpected"); },
      createSession: () => "never", now: Date.now, environment: "test",
    });
    const response = await handler(new Request("https://app.example/api/mobile/connect", {
      method: "POST", body: JSON.stringify({ roomId: "", playerId: "p1", token: "secret" }),
    }));
    expect(response.status).toBe(400);
    expect(verified).toBe(false);
  });
});
