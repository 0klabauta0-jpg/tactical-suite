import { describe, expect, it } from "vitest";

import {
  parseMapEntries,
  parseOrderMarkers,
  parsePois,
  parseTokens,
} from "@/lib/board/collections";

describe("board snapshot collections", () => {
  it("keeps only complete tokens and normalizes their map ID", () => {
    expect(parseTokens([
      { groupId: "alpha", x: 12, y: 24 },
      { groupId: "bravo", x: 3, y: 4, mapId: "moon" },
      { groupId: "broken", x: "far", y: 2 },
    ])).toEqual([
      { groupId: "alpha", x: 12, y: 24, mapId: "main" },
      { groupId: "bravo", x: 3, y: 4, mapId: "moon" },
    ]);
  });

  it("drops malformed order markers instead of passing them into map rendering", () => {
    expect(parseOrderMarkers([
      { groupId: "alpha", x: 10, y: 20 },
      { groupId: "bravo", x: 4, y: null },
    ])).toEqual([
      { groupId: "alpha", x: 10, y: 20, mapId: "main" },
    ]);
  });

  it("keeps only complete maps and POIs", () => {
    expect(parseMapEntries([
      { id: "main", label: "Pyro", image: "/pyro.png" },
      { id: "broken", label: "Broken" },
    ])).toEqual([{ id: "main", label: "Pyro", image: "/pyro.png" }]);
    expect(parsePois([
      { id: "station", label: "Ruin Station", image: "/station.png", parentMapId: "main" },
      { id: "broken", label: "Broken", image: "/broken.png" },
    ])).toEqual([{ id: "station", label: "Ruin Station", image: "/station.png", parentMapId: "main" }]);
  });
});
