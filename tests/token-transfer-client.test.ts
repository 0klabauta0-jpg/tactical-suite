import { describe, expect, it, vi } from "vitest";
import { transferTokenClient } from "@/lib/map/token-transfer-client";
import type { TokenTransferCommand } from "@/lib/map/token-transfer";

const command: TokenTransferCommand = {
  operationId: "3f7f4d48-93ce-4b34-8102-58ccdf530111",
  systemId: "nyx",
  groupId: "g1",
  expectedSource: { kind: "unplaced" },
  intent: { kind: "place2d", mapId: "main", x: 0.2, y: 0.3 },
};

describe("token transfer client", () => {
  it("sends only the normalized command with an ID token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      result: { operationId: command.operationId, groupId: "g1", systemId: "nyx", location: { kind: "map2d", mapId: "main", x: 0.2, y: 0.3 } },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await transferTokenClient("alpha", command, async () => "id-token", fetchImpl);
    expect(result.location).toMatchObject({ kind: "map2d", mapId: "main" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/rooms/alpha/token-transfers", expect.objectContaining({
      method: "POST",
      cache: "no-store",
      body: JSON.stringify(command),
      headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" },
    }));
  });

  it("preserves the current server location on a conflict", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: "Trupp wurde inzwischen von einem anderen Teilnehmer verschoben.",
      currentLocation: { kind: "map2d", mapId: "main", x: 0.8, y: 0.9 },
    }), { status: 409, headers: { "Content-Type": "application/json" } }));
    await expect(transferTokenClient("alpha", command, async () => "id-token", fetchImpl))
      .rejects.toMatchObject({
        message: "Trupp wurde inzwischen von einem anderen Teilnehmer verschoben.",
        currentLocation: { kind: "map2d", mapId: "main", x: 0.8, y: 0.9 },
      });
  });
});
