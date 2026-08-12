import { describe, expect, it } from "vitest";

import { parseBoardState, type BoardGroup } from "@/lib/board/state";

const fallbackGroups: BoardGroup[] = [
  { id: "unassigned", label: "Unzugeteilt" },
  { id: "alpha", label: "Alpha", isSpawn: true },
];

describe("parseBoardState", () => {
  it("keeps valid groups and only string player IDs in their columns", () => {
    expect(parseBoardState({
      groups: [
        { id: "alpha", label: "Alpha", color: "3b82f6", systemId: "pyro" },
        { id: 42, label: "broken" },
      ],
      columns: { alpha: ["ada", 12, "bob"], broken: ["ignored"] },
    }, fallbackGroups)).toEqual({
      groups: [{ id: "alpha", label: "Alpha", color: "3b82f6", systemId: "pyro" }],
      columns: { alpha: ["ada", "bob"] },
    });
  });

  it("uses the fallback groups for missing or malformed group data", () => {
    expect(parseBoardState({ groups: "invalid", columns: { alpha: ["ada"] } }, fallbackGroups)).toEqual({
      groups: fallbackGroups,
      columns: { unassigned: [], alpha: ["ada"] },
    });
  });
});
