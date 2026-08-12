import { describe, expect, it } from "vitest";
import { clampDockY, toggleDockSection } from "@/lib/map/control-dock";
import { DEFAULT_MAP_UI_PREFERENCES } from "@/lib/map/ui-preferences";

describe("map control dock", () => {
  it("keeps the dock inside the visible vertical area", () => {
    expect(clampDockY(-20, 800, 500)).toBe(70);
    expect(clampDockY(700, 800, 500)).toBe(292);
  });

  it("toggles only one section", () => {
    const next = toggleDockSection(DEFAULT_MAP_UI_PREFERENCES, "tokens");
    expect(next.sections).toEqual({ maps: true, tokens: false, drawing: true });
    expect(next.showGrid).toBe(true);
  });
});
