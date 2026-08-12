import { describe, expect, it } from "vitest";

import { parsePlayerOverrides } from "@/lib/players/overrides";

describe("parsePlayerOverrides", () => {
  it("retains only supported player override fields and normalizes roles", () => {
    expect(parsePlayerOverrides({
      ada: {
        appRole: " COMMANDER ",
        lastSheetAppRole: "ADMIN",
        name: "Ada Lovelace",
        squadron: "WING",
        unknown: "discarded",
      },
      broken: "not an override",
    })).toEqual({
      ada: {
        appRole: "commander",
        lastSheetAppRole: "admin",
        name: "Ada Lovelace",
        squadron: "WING",
      },
    });
  });

  it("falls back to viewer only for a supplied invalid role", () => {
    expect(parsePlayerOverrides({
      ada: { appRole: "owner" },
      bob: { area: "Recon" },
    })).toEqual({
      ada: { appRole: "viewer" },
      bob: { area: "Recon" },
    });
  });

  it("rejects non-object firestore payloads", () => {
    expect(parsePlayerOverrides(["unexpected"])).toEqual({});
  });
});
