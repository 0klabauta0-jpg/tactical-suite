import { describe, expect, it } from "vitest";
import { resolveMapRenderer } from "@/lib/map/renderer";

describe("map renderer selection", () => {
  it("gates Rockbreaker behind the room feature", () => {
    expect(resolveMapRenderer({ renderer: "rockbreaker3d" }, { rockbreaker3d: false })).toBe("disabled");
    expect(resolveMapRenderer({ renderer: "rockbreaker3d" }, { rockbreaker3d: true })).toBe("rockbreaker3d");
    expect(resolveMapRenderer({ renderer: "image2d" }, { rockbreaker3d: true })).toBe("image2d");
  });
});
