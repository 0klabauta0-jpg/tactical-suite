import { describe, expect, it } from "vitest";
import { parseTokenTransferCommand } from "@/lib/map/token-transfer";

const operationId = "3f7f4d48-93ce-4b34-8102-58ccdf530111";

describe("token transfer command", () => {
  it("accepts a map source and enter-child intent", () => {
    expect(parseTokenTransferCommand({
      operationId,
      systemId: "nyx",
      groupId: "fight-team",
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "rockbreaker" },
    })).toEqual({
      operationId,
      systemId: "nyx",
      groupId: "fight-team",
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "rockbreaker" },
    });
  });

  it("accepts Rockbreaker revisions and exact 2D placement", () => {
    expect(parseTokenTransferCommand({
      operationId,
      systemId: "nyx",
      groupId: "g1",
      expectedSource: { kind: "rockbreaker3d", sceneId: "nyx--rockbreaker", revision: 4 },
      intent: { kind: "place2d", mapId: "main", x: 0.25, y: 0.75 },
    })).not.toBeNull();
  });

  it("rejects non-finite positions, empty IDs and invalid revisions", () => {
    expect(parseTokenTransferCommand({ operationId: "short" })).toBeNull();
    expect(parseTokenTransferCommand({
      operationId,
      systemId: "nyx",
      groupId: "g1",
      expectedSource: { kind: "map2d", mapId: "main", x: Number.NaN, y: 0 },
      intent: { kind: "remove" },
    })).toBeNull();
    expect(parseTokenTransferCommand({
      operationId,
      systemId: "nyx",
      groupId: "g1",
      expectedSource: { kind: "rockbreaker3d", sceneId: "nyx--rockbreaker", revision: -1 },
      intent: { kind: "moveUp" },
    })).toBeNull();
    expect(parseTokenTransferCommand({
      operationId,
      systemId: "",
      groupId: "g1",
      expectedSource: { kind: "unplaced" },
      intent: { kind: "remove" },
    })).toBeNull();
  });

  it("rejects out-of-map placement and unknown intents", () => {
    expect(parseTokenTransferCommand({
      operationId,
      systemId: "nyx",
      groupId: "g1",
      expectedSource: { kind: "unplaced" },
      intent: { kind: "place2d", mapId: "main", x: 1.01, y: 0.5 },
    })).toBeNull();
    expect(parseTokenTransferCommand({
      operationId,
      systemId: "nyx",
      groupId: "g1",
      expectedSource: { kind: "unplaced" },
      intent: { kind: "teleport" },
    })).toBeNull();
  });
});
