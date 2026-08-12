import { describe, expect, it } from "vitest";
import { createMobileStatusHandlers, type MobileStatusContext } from "@/app/api/mobile/status/route";

const context: MobileStatusContext = {
  roomId: "room", roomName: "Operation Nyx", playerId: "p1", playerName: "Ada",
  sessionRevision: 2,
  status: {
    playerId: "p1", aliveStatus: "alive", systemId: "nyx", spawnGroupId: "spawn",
    revision: 3, updatedBy: "p1", updatedVia: "mobile", updatedAtMs: 100,
  },
  spawns: [{ id: "spawn", label: "Nyx Station" }],
  systemUnassigned: false,
};

describe("mobile status route", () => {
  it("returns only the connected player's minimal view", async () => {
    const handlers = createMobileStatusHandlers({
      getContext: async () => context,
      changeStatus: async () => ({ status: context.status }),
      appOrigin: new URL("https://app.example"), now: Date.now,
    });
    const response = await handlers.GET(new Request("https://app.example/api/mobile/status"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      roomName: "Operation Nyx", playerName: "Ada", status: context.status,
      spawns: [{ id: "spawn", label: "Nyx Station" }], systemUnassigned: false,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("changes only the cookie-bound player status", async () => {
    const calls: unknown[] = [];
    const handlers = createMobileStatusHandlers({
      getContext: async () => context,
      changeStatus: async (input) => { calls.push(input); return { status: { ...context.status, aliveStatus: "dead", revision: 4 } }; },
      appOrigin: new URL("https://app.example"), now: () => 500,
    });
    const response = await handlers.POST(new Request("https://app.example/api/mobile/status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://app.example" },
      body: JSON.stringify({ playerId: "p2", action: { type: "TOT" }, expectedRevision: 3 }),
    }));
    expect(response.status).toBe(200);
    expect(calls).toEqual([{
      roomId: "room", targetPlayerId: "p1",
      actor: { playerId: "p1", role: "viewer", via: "mobile" },
      action: { type: "TOT" }, expectedRevision: 3, nowMs: 500,
    }]);
  });

  it("rejects cross-origin and malformed status writes", async () => {
    let changed = false;
    const handlers = createMobileStatusHandlers({
      getContext: async () => context,
      changeStatus: async () => { changed = true; throw new Error("unexpected"); },
      appOrigin: new URL("https://app.example"), now: Date.now,
    });
    const crossOrigin = await handlers.POST(new Request("https://app.example/api/mobile/status", {
      method: "POST", headers: { Origin: "https://evil.example" }, body: JSON.stringify({ action: { type: "LIVE" } }),
    }));
    expect(crossOrigin.status).toBe(403);
    const malformed = await handlers.POST(new Request("https://app.example/api/mobile/status", {
      method: "POST", headers: { Origin: "https://app.example" }, body: JSON.stringify({ action: { type: "DELETE" } }),
    }));
    expect(malformed.status).toBe(400);
    expect(changed).toBe(false);
  });
});
