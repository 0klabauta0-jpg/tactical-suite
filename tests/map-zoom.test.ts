import { describe, expect, it } from "vitest";
import { zoomIn, zoomOut } from "../lib/map/zoom";

describe("map zoom controls", () => {
  it("increases the scale by 30 percent without exceeding the maximum", () => {
    expect(zoomIn(1)).toBeCloseTo(1.3);
    expect(zoomIn(7)).toBe(8);
  });

  it("decreases the scale by 30 percent without dropping below the minimum", () => {
    expect(zoomOut(1.3)).toBeCloseTo(1);
    expect(zoomOut(0.35)).toBe(0.3);
  });
});
