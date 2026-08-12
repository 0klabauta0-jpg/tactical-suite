import { describe, expect, it } from "vitest";
import { parsePlayerStatus, parsePlayerStatusAction } from "@/lib/player-status/model";

describe("player status model", () => {
  it("accepts canonical status values", () => {
    expect(parsePlayerStatus({
      playerId: "p1",
      aliveStatus: "dead",
      systemId: "nyx",
      spawnGroupId: "spawn-nyx",
      revision: 3,
      updatedBy: "p1",
      updatedVia: "mobile",
      updatedAtMs: 100,
    })).toEqual({
      playerId: "p1",
      aliveStatus: "dead",
      systemId: "nyx",
      spawnGroupId: "spawn-nyx",
      revision: 3,
      updatedBy: "p1",
      updatedVia: "mobile",
      updatedAtMs: 100,
    });
  });

  it("rejects malformed status and action values", () => {
    expect(parsePlayerStatus({ playerId: "p1", aliveStatus: "unknown", revision: -1 })).toBeNull();
    expect(parsePlayerStatusAction({ type: "RESPAWN", spawnGroupId: "spawn-a" })).toEqual({ type: "RESPAWN", spawnGroupId: "spawn-a" });
    expect(parsePlayerStatusAction({ type: "RESPAWN", spawnGroupId: "" })).toBeNull();
    expect(parsePlayerStatusAction({ type: "DELETE" })).toBeNull();
  });
});
