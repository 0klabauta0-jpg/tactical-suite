import { describe, expect, it } from "vitest";
import { mergeWithOverrides } from "@/lib/players/merge-overrides";

const sheetPlayer = {
  id: "pilot-7",
  name: "Ada Lovelace",
  appRole: "viewer" as const,
};

describe("mergeWithOverrides", () => {
  it("applies a manual override when the sheet role has not changed", () => {
    const players = mergeWithOverrides([sheetPlayer], {
      "pilot-7": { appRole: "commander", lastSheetAppRole: "viewer" },
    });

    expect(players[0]?.appRole).toBe("commander");
  });

  it("uses the changed sheet role during the current merge", () => {
    const players = mergeWithOverrides([{ ...sheetPlayer, appRole: "admin" }], {
      "pilot-7": { appRole: "commander", lastSheetAppRole: "viewer" },
    });

    expect(players[0]?.appRole).toBe("admin");
  });

  it("keeps sheet data when no override exists", () => {
    const players = mergeWithOverrides([sheetPlayer], {});

    expect(players).toEqual([sheetPlayer]);
  });
});
