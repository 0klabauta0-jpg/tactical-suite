import { describe, expect, it } from "vitest";
import { changePlayerStatus, PlayerStatusStoreError, type PlayerStatusTransaction, type PlayerStatusTransactionStore } from "@/lib/server/player-status-store";

function createStore() {
  const state = {
    board: {
      groups: [
        { id: "alpha", label: "Alpha", systemId: "nyx" },
        { id: "spawn", label: "Spawn", systemId: "nyx", isSpawn: true },
      ],
      columns: { alpha: ["p1", "p2"], spawn: [] },
      aliveState: { p1: "alive", p2: "dead" },
      spawnState: { p1: "spawn", p2: "spawn" },
      untouched: "keep",
    } as Record<string, unknown>,
    statuses: new Map<string, unknown>(),
    writes: [] as Array<{ kind: string; value: unknown }>,
  };
  const transaction: PlayerStatusTransaction = {
    getBoard: async () => structuredClone(state.board),
    getStatus: async (_roomId, playerId) => structuredClone(state.statuses.get(playerId) ?? null),
    setBoardFields: async (_roomId, fields) => {
      state.board = { ...state.board, ...structuredClone(fields) };
      state.writes.push({ kind: "board", value: fields });
    },
    setStatus: async (_roomId, playerId, status) => {
      state.statuses.set(playerId, structuredClone(status));
      state.writes.push({ kind: "status", value: status });
    },
  };
  const store: PlayerStatusTransactionStore = { runTransaction: (operation) => operation(transaction) };
  return { state, store };
}

describe("player status transaction store", () => {
  it("creates canonical status from legacy fields and preserves unrelated board values", async () => {
    const { state, store } = createStore();
    const result = await changePlayerStatus(store, {
      roomId: "room", targetPlayerId: "p1", actor: { playerId: "p1", role: "viewer", via: "desktop" },
      action: { type: "TOT" }, nowMs: 500,
    });
    expect(result.status).toMatchObject({ playerId: "p1", aliveStatus: "dead", revision: 1 });
    expect(state.board.untouched).toBe("keep");
    expect(state.board.aliveState).toEqual({ p1: "dead", p2: "dead" });
    expect(state.board.spawnState).toEqual({ p1: "spawn", p2: "spawn" });
    expect((state.board.columns as Record<string, string[]>).spawn).toEqual(["p1"]);
  });

  it("allows a commander to update another player but denies a viewer", async () => {
    const denied = createStore();
    await expect(changePlayerStatus(denied.store, {
      roomId: "room", targetPlayerId: "p2", actor: { playerId: "p1", role: "viewer", via: "desktop" },
      action: { type: "LIVE" }, nowMs: 500,
    })).rejects.toEqual(new PlayerStatusStoreError("FORBIDDEN"));
    expect(denied.state.writes).toHaveLength(0);

    const allowed = createStore();
    await expect(changePlayerStatus(allowed.store, {
      roomId: "room", targetPlayerId: "p2", actor: { playerId: "p1", role: "commander", via: "desktop" },
      action: { type: "LIVE" }, nowMs: 500,
    })).resolves.toMatchObject({ status: { aliveStatus: "alive" } });
  });

  it("limits mobile actions to the connected player", async () => {
    const { state, store } = createStore();
    await expect(changePlayerStatus(store, {
      roomId: "room", targetPlayerId: "p2", actor: { playerId: "p1", role: "viewer", via: "mobile" },
      action: { type: "LIVE" }, nowMs: 500,
    })).rejects.toEqual(new PlayerStatusStoreError("FORBIDDEN"));
    expect(state.writes).toHaveLength(0);
  });

  it("returns the current status on a revision conflict without writing", async () => {
    const { state, store } = createStore();
    state.statuses.set("p1", {
      playerId: "p1", aliveStatus: "alive", systemId: "nyx", spawnGroupId: "spawn", revision: 4,
      updatedBy: "p1", updatedVia: "desktop", updatedAtMs: 100,
    });
    await expect(changePlayerStatus(store, {
      roomId: "room", targetPlayerId: "p1", actor: { playerId: "p1", role: "viewer", via: "desktop" },
      action: { type: "LIVE" }, expectedRevision: 3, nowMs: 500,
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT", currentStatus: { revision: 4 } });
    expect(state.writes).toHaveLength(0);
  });

  it("does not write when the requested spawn is invalid", async () => {
    const { state, store } = createStore();
    await expect(changePlayerStatus(store, {
      roomId: "room", targetPlayerId: "p1", actor: { playerId: "p1", role: "viewer", via: "mobile" },
      action: { type: "RESPAWN", spawnGroupId: "missing" }, nowMs: 500,
    })).rejects.toMatchObject({ code: "INVALID_SPAWN" });
    expect(state.writes).toHaveLength(0);
  });
});
