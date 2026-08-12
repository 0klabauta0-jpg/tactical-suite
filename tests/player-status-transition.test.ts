import { describe, expect, it } from "vitest";
import type { BoardState } from "@/lib/board/state";
import { applyPlayerStatusAction, derivePlayerSystem, PlayerStatusTransitionError } from "@/lib/player-status/transition";

const board: BoardState = {
  groups: [
    { id: "alpha", label: "Alpha", systemId: "nyx" },
    { id: "spawn-nyx", label: "Nyx Spawn", systemId: "nyx", isSpawn: true },
    { id: "spawn-pyro", label: "Pyro Spawn", systemId: "pyro", isSpawn: true },
  ],
  columns: {
    alpha: ["p1", "p2", "p1"],
    "spawn-nyx": [],
    "spawn-pyro": ["p3"],
  },
};

function transition(action: { type: "LIVE" | "TOT" } | { type: "RESPAWN" | "SET_SPAWN"; spawnGroupId: string }) {
  return applyPlayerStatusAction({
    playerId: "p1",
    currentStatus: {
      playerId: "p1", aliveStatus: "alive", systemId: "nyx", spawnGroupId: "spawn-nyx",
      revision: 4, updatedBy: "p1", updatedVia: "desktop", updatedAtMs: 100,
    },
    action,
    board,
    legacyAliveState: { p1: "alive", p2: "dead" },
    legacySpawnState: { p1: "spawn-nyx", p2: "spawn-pyro" },
    actorPlayerId: "p1",
    via: "mobile",
    nowMs: 200,
  });
}

describe("player status transitions", () => {
  it("updates only the target life status and revision", () => {
    const next = transition({ type: "LIVE" });
    expect(next.status.aliveStatus).toBe("alive");
    expect(next.status.revision).toBe(5);
    expect(next.legacyAliveState).toEqual({ p1: "alive", p2: "dead" });
    expect(next.board.columns).toEqual(board.columns);
  });

  it("moves a dead player exactly once to the selected spawn", () => {
    const next = transition({ type: "TOT" });
    expect(next.status.aliveStatus).toBe("dead");
    expect(next.board.columns.alpha).toEqual(["p2"]);
    expect(next.board.columns["spawn-nyx"]).toEqual(["p1"]);
    expect(next.board.columns["spawn-pyro"]).toEqual(["p3"]);
  });

  it("respawns at an allowed spawn and preserves other players", () => {
    const next = transition({ type: "RESPAWN", spawnGroupId: "spawn-nyx" });
    expect(next.status).toMatchObject({ aliveStatus: "alive", spawnGroupId: "spawn-nyx", systemId: "nyx" });
    expect(next.legacySpawnState).toEqual({ p1: "spawn-nyx", p2: "spawn-pyro" });
    expect(next.board.columns["spawn-nyx"]).toEqual(["p1"]);
  });

  it("changes only the spawn preference for SET_SPAWN", () => {
    const next = transition({ type: "SET_SPAWN", spawnGroupId: "spawn-nyx" });
    expect(next.board).toEqual(board);
    expect(next.status.spawnGroupId).toBe("spawn-nyx");
  });

  it("rejects a spawn in a different system without mutation", () => {
    expect(() => transition({ type: "RESPAWN", spawnGroupId: "spawn-pyro" }))
      .toThrowError(new PlayerStatusTransitionError("INVALID_SPAWN"));
  });

  it("does not guess a system when no assignment exists", () => {
    expect(derivePlayerSystem("p9", board, null, {})).toBeNull();
  });
});
