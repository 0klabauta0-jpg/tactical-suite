import { describe, expect, it, vi } from "vitest";
import { changePlayerStatusClient } from "@/lib/player-status/client";

describe("player status client", () => {
  it("sends only the action and expected revision with the ID token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: { revision: 3 } }), { status: 200 }));
    await changePlayerStatusClient({
      roomId: "alpha", playerId: "p1", action: { type: "TOT" }, expectedRevision: 2,
      getIdToken: async () => "id-token", fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/rooms/alpha/player-status/p1", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer id-token" },
      body: JSON.stringify({ action: { type: "TOT" }, expectedRevision: 2 }),
    }));
  });

  it("surfaces a safe server error", async () => {
    await expect(changePlayerStatusClient({
      roomId: "alpha", playerId: "p1", action: { type: "LIVE" },
      getIdToken: async () => "id-token",
      fetchImpl: async () => new Response(JSON.stringify({ error: "Nicht erlaubt." }), { status: 403 }),
    })).rejects.toThrow("Nicht erlaubt.");
  });
});
