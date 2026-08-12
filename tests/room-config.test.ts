import { describe, expect, it } from "vitest";

import { parseRoomConfig } from "@/lib/rooms/config";

describe("parseRoomConfig", () => {
  it("keeps the supported room configuration fields", () => {
    expect(parseRoomConfig({
      sheetUrl: "https://example.test/players.csv",
      password: "team-secret",
      roomName: "Alpha Ops",
      sheetShareUrl: "https://example.test/edit",
      ignored: true,
    })).toEqual({
      sheetUrl: "https://example.test/players.csv",
      password: "team-secret",
      roomName: "Alpha Ops",
      sheetShareUrl: "https://example.test/edit",
    });
  });

  it("rejects configurations without usable sheet URL and password", () => {
    expect(parseRoomConfig({ sheetUrl: "", password: "team-secret" })).toBeNull();
    expect(parseRoomConfig({ sheetUrl: "https://example.test/players.csv", password: 42 })).toBeNull();
    expect(parseRoomConfig(["unexpected"])).toBeNull();
  });
});
