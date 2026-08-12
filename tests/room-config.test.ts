import { describe, expect, it } from "vitest";

import { parseRoomConfig } from "@/lib/rooms/config";

describe("parseRoomConfig", () => {
  it("keeps the supported room configuration fields", () => {
    expect(parseRoomConfig({
      sheetUrl: "https://example.test/players.csv",
      password: "team-secret",
      roomName: "Alpha Ops",
      sheetShareUrl: "https://example.test/edit",
      features: { rockbreaker3d: true, mobileStatus: "yes" },
      ignored: true,
    })).toEqual({
      sheetUrl: "https://example.test/players.csv",
      roomName: "Alpha Ops",
      sheetShareUrl: "https://example.test/edit",
      features: { rockbreaker3d: true, mobileStatus: false },
    });
  });

  it("rejects configurations without a usable sheet URL and defaults features off", () => {
    expect(parseRoomConfig({ sheetUrl: "" })).toBeNull();
    expect(parseRoomConfig({ sheetUrl: "https://example.test/players.csv" })).toEqual({
      sheetUrl: "https://example.test/players.csv",
      features: { rockbreaker3d: false, mobileStatus: false },
    });
    expect(parseRoomConfig(["unexpected"])).toBeNull();
  });
});
