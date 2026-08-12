import { describe, expect, it } from "vitest";
import { DEFAULT_ROCKBREAKER_ENTRY } from "@/lib/rockbreaker/scene-config";
import { groupTokenObjectId, type SceneObject } from "@/lib/rockbreaker/scene-objects";
import {
  executeTokenTransfer,
  parseTokenTransferReceipt,
  TokenTransferStoreError,
  type ExecuteTokenTransferInput,
  type TokenTransferReceipt,
  type TokenTransferSnapshot,
  type TokenTransferTransaction,
  type TokenTransferTransactionStore,
} from "@/lib/server/token-transfer-store";
import type { TokenTransferCommand } from "@/lib/map/token-transfer";

const operationIds = [
  "3f7f4d48-93ce-4b34-8102-58ccdf530111",
  "3f7f4d48-93ce-4b34-8102-58ccdf530112",
  "3f7f4d48-93ce-4b34-8102-58ccdf530113",
];

function sceneGroup(groupId = "g1", revision = 3, position = DEFAULT_ROCKBREAKER_ENTRY.slots[0]): SceneObject {
  return {
    id: groupTokenObjectId(groupId),
    type: "groupToken",
    groupId,
    systemId: "nyx",
    mapId: "rockbreaker",
    sceneVersion: 1,
    color: "#0ea5e9",
    position,
    revision,
    createdBy: "u0",
    createdAtMs: 1,
    updatedBy: "u0",
    updatedAtMs: 1,
  };
}

type FixtureOptions = {
  tokens?: Array<{ groupId: string; mapId: string; x: number; y: number }>;
  sceneObjects?: SceneObject[];
  rockbreakerEnabled?: boolean;
  sceneMetadata?: unknown;
};

function transferFixture(options: FixtureOptions = {}) {
  const state = {
    board: {
      groups: [
        { id: "g1", label: "Fight Team", color: "0ea5e9", systemId: "nyx" },
        { id: "g2", label: "Air Team", color: "ef4444", systemId: "nyx" },
        { id: "spawn", label: "Spawn", isSpawn: true, systemId: "nyx" },
      ],
      columns: { g1: [], g2: [], spawn: [] },
      tokensBySystem: { nyx: options.tokens ?? [] },
      mapsBySystem: {
        nyx: [
          { id: "main", label: "Nyx", image: "/nyx.png", renderer: "image2d" },
          { id: "cap", label: "Cap Map", image: "/cap.png", renderer: "image2d", x: 0.3, y: 0.4 },
          { id: "rockbreaker", label: "Rockbreaker", image: "", renderer: "rockbreaker3d", sceneId: "nyx--rockbreaker", x: 0.5, y: 0.5 },
        ],
      },
      poisBySystem: { nyx: [{ id: "deep", label: "Deep", image: "/deep.png", parentMapId: "cap", x: 0.6, y: 0.7 }] },
      untouched: "keep",
    } as Record<string, unknown>,
    roomConfig: { sheetUrl: "https://example.test/players.csv", features: { rockbreaker3d: options.rockbreakerEnabled ?? true, mobileStatus: true } },
    sceneMetadata: options.sceneMetadata ?? {
      systemId: "nyx",
      mapId: "rockbreaker",
      renderer: "rockbreaker3d",
      sceneVersion: 1,
      troopEntry: DEFAULT_ROCKBREAKER_ENTRY,
    },
    sceneObjects: new Map((options.sceneObjects ?? []).map((object) => [object.id, object])),
    receipts: new Map<string, TokenTransferReceipt>(),
    writes: [] as string[],
  };

  const transaction: TokenTransferTransaction = {
    readSnapshot: async (_roomId, operationId): Promise<TokenTransferSnapshot> => ({
      boardDocument: structuredClone(state.board),
      roomConfig: structuredClone(state.roomConfig),
      sceneMetadata: structuredClone(state.sceneMetadata),
      sceneObjects: structuredClone([...state.sceneObjects.values()]),
      receipt: structuredClone(state.receipts.get(operationId) ?? null),
    }),
    setTokensBySystem: async (_roomId, value) => {
      state.board.tokensBySystem = structuredClone(value);
      state.writes.push("board");
    },
    setSceneGroup: async (_roomId, object) => {
      state.sceneObjects.set(object.id, structuredClone(object));
      state.writes.push(`scene:set:${object.id}`);
    },
    deleteSceneGroup: async (_roomId, objectId) => {
      state.sceneObjects.delete(objectId);
      state.writes.push(`scene:delete:${objectId}`);
    },
    setReceipt: async (_roomId, receipt) => {
      state.receipts.set(receipt.operationId, structuredClone(receipt));
      state.writes.push(`receipt:${receipt.operationId}`);
    },
  };
  const store: TokenTransferTransactionStore = {
    runTransaction: async (operation) => {
      const before = structuredClone({
        board: state.board,
        sceneObjects: [...state.sceneObjects.entries()],
        receipts: [...state.receipts.entries()],
        writes: state.writes,
      });
      try {
        return await operation(transaction);
      } catch (error) {
        state.board = before.board;
        state.sceneObjects = new Map(before.sceneObjects);
        state.receipts = new Map(before.receipts);
        state.writes = before.writes;
        throw error;
      }
    },
  };
  return {
    state,
    store,
    tokens: () => ((state.board.tokensBySystem as Record<string, unknown[]>).nyx ?? []),
    groupObject: (groupId: string) => {
      const object = state.sceneObjects.get(groupTokenObjectId(groupId));
      return object && "position" in object ? object : null;
    },
  };
}

function command(overrides: Partial<TokenTransferCommand> = {}): TokenTransferCommand {
  return {
    operationId: operationIds[0],
    systemId: "nyx",
    groupId: "g1",
    expectedSource: { kind: "unplaced" },
    intent: { kind: "remove" },
    ...overrides,
  };
}

function transferInput(commandValue: TokenTransferCommand, overrides: Partial<ExecuteTokenTransferInput> = {}): ExecuteTokenTransferInput {
  return {
    roomId: "room",
    actor: { uid: "u1", role: "commander" },
    command: commandValue,
    nowMs: 1_000,
    ...overrides,
  };
}

describe("token transfer transaction store", () => {
  it("validates stored idempotency receipts at the Firestore boundary", () => {
    const normalizedCommand = command();
    expect(parseTokenTransferReceipt({
      operationId: operationIds[0],
      command: normalizedCommand,
      result: { operationId: operationIds[0], groupId: "g1", systemId: "nyx", location: { kind: "unplaced" } },
      actorUid: "u1",
      completedAtMs: 100,
      expiresAtMs: 200,
    })).not.toBeNull();
    expect(parseTokenTransferReceipt({ operationId: operationIds[0], command: normalizedCommand, result: { location: { kind: "map2d", x: Number.NaN } } })).toBeNull();
  });

  it("atomically moves a Nyx board token into the first free Rockbreaker entry slot", async () => {
    const fixture = transferFixture({ tokens: [{ groupId: "g1", mapId: "main", x: 0.4, y: 0.6 }] });
    const result = await executeTokenTransfer(fixture.store, transferInput(command({
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "rockbreaker" },
    })));
    expect(result.location).toEqual({ kind: "rockbreaker3d", sceneId: "nyx--rockbreaker", revision: 0 });
    expect(fixture.tokens()).toEqual([]);
    expect(fixture.groupObject("g1")?.position).toEqual(DEFAULT_ROCKBREAKER_ENTRY.slots[0]);
    expect(fixture.state.writes).toEqual(["board", "scene:set:groupToken--g1", `receipt:${operationIds[0]}`]);
  });

  it("uses the next free shared 3D entry slot", async () => {
    const fixture = transferFixture({
      tokens: [{ groupId: "g1", mapId: "main", x: 0.4, y: 0.6 }],
      sceneObjects: [sceneGroup("g2", 0, DEFAULT_ROCKBREAKER_ENTRY.slots[0])],
    });
    await executeTokenTransfer(fixture.store, transferInput(command({
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "rockbreaker" },
    })));
    expect(fixture.groupObject("g1")?.position).toEqual(DEFAULT_ROCKBREAKER_ENTRY.slots[1]);
  });

  it("moves a Rockbreaker group one level up beside its Nyx pill", async () => {
    const fixture = transferFixture({ sceneObjects: [sceneGroup("g1", 3)] });
    const result = await executeTokenTransfer(fixture.store, transferInput(command({
      expectedSource: { kind: "rockbreaker3d", sceneId: "nyx--rockbreaker", revision: 3 },
      intent: { kind: "moveUp" },
    })));
    expect(result.location).toEqual({ kind: "map2d", mapId: "main", x: 0.54, y: 0.5 });
    expect(fixture.groupObject("g1")).toBeNull();
    expect(fixture.tokens()[0]).toMatchObject({ groupId: "g1", mapId: "main", x: 0.54, y: 0.5 });
  });

  it("enters a normal 2D child and returns exactly one level", async () => {
    const fixture = transferFixture({ tokens: [{ groupId: "g1", mapId: "cap", x: 0.4, y: 0.6 }] });
    await executeTokenTransfer(fixture.store, transferInput(command({
      expectedSource: { kind: "map2d", mapId: "cap", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "deep" },
    })));
    expect(fixture.tokens()[0]).toMatchObject({ mapId: "deep", x: 0.08, y: 0.16 });
    await executeTokenTransfer(fixture.store, transferInput(command({
      operationId: operationIds[1],
      expectedSource: { kind: "map2d", mapId: "deep", x: 0.08, y: 0.16 },
      intent: { kind: "moveUp" },
    })));
    expect(fixture.tokens()[0]).toMatchObject({ mapId: "cap", x: 0.64, y: 0.7 });
  });

  it("moves on the same 2D map and removes to an unplaced state", async () => {
    const fixture = transferFixture({ tokens: [{ groupId: "g1", mapId: "main", x: 0.1, y: 0.2 }] });
    await executeTokenTransfer(fixture.store, transferInput(command({
      expectedSource: { kind: "map2d", mapId: "main", x: 0.1, y: 0.2 },
      intent: { kind: "place2d", mapId: "main", x: 0.8, y: 0.9 },
    })));
    expect(fixture.tokens()[0]).toEqual({ groupId: "g1", mapId: "main", x: 0.8, y: 0.9 });
    await executeTokenTransfer(fixture.store, transferInput(command({
      operationId: operationIds[1],
      expectedSource: { kind: "map2d", mapId: "main", x: 0.8, y: 0.9 },
      intent: { kind: "remove" },
    })));
    expect(fixture.tokens()).toEqual([]);
  });

  it("deduplicates a matching operation and rejects ID reuse", async () => {
    const fixture = transferFixture();
    const firstCommand = command({ intent: { kind: "place2d", mapId: "main", x: 0.2, y: 0.3 } });
    const first = await executeTokenTransfer(fixture.store, transferInput(firstCommand));
    const writesAfterFirst = [...fixture.state.writes];
    await expect(executeTokenTransfer(fixture.store, transferInput(firstCommand))).resolves.toEqual(first);
    expect(fixture.state.writes).toEqual(writesAfterFirst);
    await expect(executeTokenTransfer(fixture.store, transferInput(command({ intent: { kind: "place2d", mapId: "main", x: 0.7, y: 0.3 } }))))
      .rejects.toEqual(new TokenTransferStoreError("OPERATION_CONFLICT"));
  });

  it("rejects stale and ambiguous sources without partial writes", async () => {
    const stale = transferFixture({ tokens: [{ groupId: "g1", mapId: "main", x: 0.4, y: 0.6 }] });
    await expect(executeTokenTransfer(stale.store, transferInput(command({
      expectedSource: { kind: "map2d", mapId: "main", x: 0.3, y: 0.6 },
      intent: { kind: "remove" },
    })))).rejects.toMatchObject({ code: "SOURCE_CONFLICT", currentLocation: { x: 0.4 } });
    expect(stale.state.writes).toEqual([]);

    const ambiguous = transferFixture({
      tokens: [{ groupId: "g1", mapId: "main", x: 0.4, y: 0.6 }],
      sceneObjects: [sceneGroup("g1", 2)],
    });
    await expect(executeTokenTransfer(ambiguous.store, transferInput(command({ intent: { kind: "remove" } }))))
      .rejects.toMatchObject({ code: "AMBIGUOUS_SOURCE" });
    expect(ambiguous.state.writes).toEqual([]);
  });

  it("denies viewers, spawn groups, disabled Rockbreaker and invalid hierarchy", async () => {
    const viewer = transferFixture();
    await expect(executeTokenTransfer(viewer.store, transferInput(command(), { actor: { uid: "viewer", role: "viewer" } })))
      .rejects.toEqual(new TokenTransferStoreError("FORBIDDEN"));
    expect(viewer.state.writes).toEqual([]);

    const spawn = transferFixture();
    await expect(executeTokenTransfer(spawn.store, transferInput(command({ groupId: "spawn" }))))
      .rejects.toMatchObject({ code: "INVALID_GROUP" });

    const disabled = transferFixture({ rockbreakerEnabled: false, tokens: [{ groupId: "g1", mapId: "main", x: 0.4, y: 0.6 }] });
    await expect(executeTokenTransfer(disabled.store, transferInput(command({
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "rockbreaker" },
    })))).rejects.toMatchObject({ code: "FEATURE_DISABLED" });

    const hierarchy = transferFixture({ tokens: [{ groupId: "g1", mapId: "main", x: 0.4, y: 0.6 }] });
    await expect(executeTokenTransfer(hierarchy.store, transferInput(command({
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "deep" },
    })))).rejects.toMatchObject({ code: "INVALID_TARGET" });
  });

  it("rejects a full or malformed Rockbreaker entry configuration", async () => {
    const oneSlotMetadata = {
      systemId: "nyx", mapId: "rockbreaker", renderer: "rockbreaker3d", sceneVersion: 1,
      troopEntry: { slots: [DEFAULT_ROCKBREAKER_ENTRY.slots[0]] },
    };
    const full = transferFixture({
      tokens: [{ groupId: "g1", mapId: "main", x: 0.4, y: 0.6 }],
      sceneObjects: [sceneGroup("g2", 0)],
      sceneMetadata: oneSlotMetadata,
    });
    await expect(executeTokenTransfer(full.store, transferInput(command({
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "rockbreaker" },
    })))).rejects.toMatchObject({ code: "ENTRY_FULL" });

    const malformed = transferFixture({
      tokens: [{ groupId: "g1", mapId: "main", x: 0.4, y: 0.6 }],
      sceneMetadata: {},
    });
    await expect(executeTokenTransfer(malformed.store, transferInput(command({
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "rockbreaker" },
    })))).rejects.toMatchObject({ code: "INVALID_TARGET" });
  });
});
