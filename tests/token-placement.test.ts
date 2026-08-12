import { describe, expect, it } from "vitest";
import {
  resolveChildLocation,
  resolveParentLocation,
  selectEntry2dPosition,
  selectReturn2dPosition,
} from "@/lib/map/token-placement";
import type { BoardMapEntry, BoardPoi, BoardToken } from "@/lib/board/collections";

const maps: BoardMapEntry[] = [
  { id: "main", label: "Nyx", image: "/nyx.png", renderer: "image2d" },
  { id: "cap-map", label: "Cap Map", image: "/cap.png", renderer: "image2d", x: 0.3, y: 0.4 },
];
const pois: BoardPoi[] = [
  { id: "poi-a", label: "A", image: "/a.png", parentMapId: "cap-map", x: 0.4, y: 0.5 },
];

describe("token hierarchy and placement", () => {
  it("resolves Rockbreaker below Nyx main and a POI below its parent", () => {
    expect(resolveChildLocation("nyx", "rockbreaker", maps, pois, true)).toEqual({
      kind: "rockbreaker3d",
      sceneId: "nyx--rockbreaker",
      parentMapId: "main",
    });
    expect(resolveChildLocation("nyx", "poi-a", maps, pois, true)).toEqual({
      kind: "map2d",
      mapId: "poi-a",
      parentMapId: "cap-map",
    });
  });

  it("rejects disabled or misplaced Rockbreaker targets", () => {
    expect(resolveChildLocation("nyx", "rockbreaker", maps, pois, false)).toBeNull();
    expect(resolveChildLocation("pyro", "rockbreaker", maps, pois, true)).toBeNull();
    expect(resolveChildLocation("nyx", "main", maps, pois, true)).toBeNull();
  });

  it("resolves one parent level and its marker position", () => {
    expect(resolveParentLocation("poi-a", maps, pois)).toEqual({
      parentMapId: "cap-map",
      marker: { x: 0.4, y: 0.5 },
    });
    expect(resolveParentLocation("cap-map", maps, pois)).toEqual({
      parentMapId: "main",
      marker: { x: 0.3, y: 0.4 },
    });
    expect(resolveParentLocation("main", maps, pois)).toBeNull();
  });

  it("uses deterministic non-overlapping 2D entry and return slots", () => {
    const occupied: BoardToken[] = [{ groupId: "g1", mapId: "cap-map", x: 0.08, y: 0.16 }];
    expect(selectEntry2dPosition("cap-map", occupied)).toEqual({ x: 0.08, y: 0.24 });
    expect(selectReturn2dPosition({ x: 0.5, y: 0.5 }, [])).toEqual({ x: 0.54, y: 0.5 });
  });

  it("clamps return slots near the edge", () => {
    expect(selectReturn2dPosition({ x: 0.99, y: 0.99 }, [])).toEqual({ x: 0.98, y: 0.98 });
  });
});
