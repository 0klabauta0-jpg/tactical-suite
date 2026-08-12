import { describe, expect, it } from "vitest";
import { createMobileLinkHandlers } from "@/app/api/rooms/[roomId]/mobile-link/route";
import { MobileLinkStoreError } from "@/lib/server/mobile-link-store";

const context = { params: Promise.resolve({ roomId: "alpha" }) };
const member = { uid: "u1", playerId: "p1", name: "Ada", role: "viewer" as const, authVersion: 1 as const, verifiedAtMs: 1 };

describe("mobile link route", () => {
  it("issues only the authenticated player's fragment URL", async () => {
    const calls: unknown[] = [];
    const handlers = createMobileLinkHandlers({
      requireMember: async () => member,
      issue: async (input) => { calls.push(input); return { token: "secret-token", sessionRevision: 3, expiresAtMs: 99 }; },
      revoke: async () => ({ sessionRevision: 4 }),
      appOrigin: new URL("https://app.example"), now: () => 10,
    });
    const response = await handlers.POST(new Request("https://app.example", { method: "POST", body: JSON.stringify({ playerId: "p2" }) }), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.url).toBe("https://app.example/connect#r=alpha&p=p1&t=secret-token");
    expect(calls).toEqual([{ roomId: "alpha", playerId: "p1", nowMs: 10, ttlMs: 2_592_000_000 }]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a feature-disabled response without link data", async () => {
    const handlers = createMobileLinkHandlers({
      requireMember: async () => member,
      issue: async () => { throw new MobileLinkStoreError("FEATURE_DISABLED"); },
      revoke: async () => ({ sessionRevision: 1 }),
      appOrigin: new URL("https://app.example"), now: Date.now,
    });
    const response = await handlers.POST(new Request("https://app.example", { method: "POST" }), context);
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("token");
  });
});
