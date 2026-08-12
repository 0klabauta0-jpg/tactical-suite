import { describe, expect, it } from "vitest";
import { buildTokenLocationNormalization } from "@/lib/release/token-location-normalization";

describe("token location normalization", () => {
  it("keeps the one group-owned location and removes foreign-system shadows", () => {
    const board = {
      groups: [{ id: "drop", label: "Drop", systemId: "stanton" }],
      mapsBySystem: { stanton: [{ id: "main" }, { id: "daymar" }] },
      poisBySystem: { stanton: [{ id: "lamina", parentMapId: "daymar" }] },
      tokensBySystem: {
        pyro: [{ groupId: "drop", mapId: "main", x: 0.8, y: 0.6 }],
        stanton: [{ groupId: "drop", mapId: "lamina", x: 0.5, y: 0.7 }],
      },
    };
    const before = structuredClone(board);

    const result = buildTokenLocationNormalization(board);

    expect(result.unresolved).toEqual([]);
    expect(result.removals).toEqual([expect.objectContaining({
      groupId: "drop",
      systemId: "pyro",
      mapId: "main",
      reason: "foreign-system",
    })]);
    expect(result.tokensBySystem).toEqual({
      pyro: [],
      stanton: [{ groupId: "drop", mapId: "lamina", x: 0.5, y: 0.7 }],
    });
    expect(board).toEqual(before);
  });

  it("keeps a unique deepest child and removes its derived parent shadow", () => {
    const result = buildTokenLocationNormalization({
      groups: [{ id: "ft2", label: "FT2", systemId: "stanton" }],
      mapsBySystem: { stanton: [{ id: "main" }, { id: "daymar" }] },
      poisBySystem: { stanton: [{ id: "attritus", parentMapId: "daymar" }] },
      tokensBySystem: { stanton: [
        { groupId: "ft2", mapId: "attritus", x: 0.3, y: 0.5 },
        { groupId: "ft2", mapId: "daymar", x: 0.7, y: 0.8 },
      ] },
    });

    expect(result.unresolved).toEqual([]);
    expect(result.tokensBySystem.stanton).toEqual([
      { groupId: "ft2", mapId: "attritus", x: 0.3, y: 0.5 },
    ]);
    expect(result.removals).toEqual([expect.objectContaining({
      groupId: "ft2",
      mapId: "daymar",
      reason: "ancestor-shadow",
    })]);
  });

  it("refuses sibling, same-map, unknown, and foreign-only ambiguities", () => {
    const result = buildTokenLocationNormalization({
      groups: [
        { id: "siblings", systemId: "stanton" },
        { id: "same-map", systemId: "stanton" },
        { id: "foreign-only", systemId: "stanton" },
      ],
      mapsBySystem: { stanton: [{ id: "main" }, { id: "daymar" }] },
      poisBySystem: { stanton: [
        { id: "a", parentMapId: "daymar" },
        { id: "b", parentMapId: "daymar" },
      ] },
      tokensBySystem: {
        pyro: [
          { groupId: "foreign-only", mapId: "main", x: 0.1, y: 0.1 },
          { groupId: "ghost", mapId: "main", x: 0.2, y: 0.2 },
        ],
        stanton: [
          { groupId: "siblings", mapId: "a", x: 0.1, y: 0.1 },
          { groupId: "siblings", mapId: "b", x: 0.2, y: 0.2 },
          { groupId: "same-map", mapId: "daymar", x: 0.3, y: 0.3 },
          { groupId: "same-map", mapId: "daymar", x: 0.4, y: 0.4 },
        ],
      },
    });

    expect(result.removals).toEqual([]);
    expect(result.unresolved.map((issue) => issue.groupId).sort()).toEqual([
      "foreign-only",
      "ghost",
      "same-map",
      "siblings",
    ]);
  });
});
