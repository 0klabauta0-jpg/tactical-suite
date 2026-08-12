import { describe, expect, it } from "vitest";
import { planPlayerStatusMigration } from "@/lib/player-status/migration";

const board = {
  groups: [
    { id: "alpha", label: "Alpha", systemId: "nyx" },
    { id: "spawn", label: "Spawn", systemId: "nyx", isSpawn: true },
  ],
  columns: { alpha: ["p1"], spawn: ["p2"] },
  aliveState: { p1: "dead", p2: "broken" },
  spawnState: { p1: "spawn", p2: "missing" },
};

describe("player status migration", () => {
  it("creates missing canonical documents and reports invalid legacy values", () => {
    const plan = planPlayerStatusMigration(board, new Map(), 100);
    expect(plan.writes).toHaveLength(2);
    expect(plan.writes.find((write) => write.playerId === "p1")?.status).toMatchObject({ aliveStatus: "dead", systemId: "nyx", spawnGroupId: "spawn", revision: 0, updatedVia: "migration" });
    expect(plan.writes.find((write) => write.playerId === "p2")?.status).toMatchObject({ aliveStatus: "alive", systemId: "nyx" });
    expect(plan.warnings).toEqual(expect.arrayContaining(["p2: invalid alive status", "p2: invalid spawn group"]));
  });

  it("is idempotent for existing valid documents", () => {
    const first = planPlayerStatusMigration(board, new Map(), 100);
    const existing = new Map(first.writes.map((write) => [write.playerId, write.status]));
    expect(planPlayerStatusMigration(board, existing, 200).writes).toHaveLength(0);
  });
});
