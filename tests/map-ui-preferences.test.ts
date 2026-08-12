import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_UI_PREFERENCES, loadMapUiPreferences, parseMapUiPreferences } from "@/lib/map/ui-preferences";

describe("map UI preferences", () => {
  it("starts with a visible grid and expanded dock", () => {
    expect(parseMapUiPreferences(undefined)).toEqual(DEFAULT_MAP_UI_PREFERENCES);
    expect(DEFAULT_MAP_UI_PREFERENCES.showGrid).toBe(true);
    expect(DEFAULT_MAP_UI_PREFERENCES.dockCollapsed).toBe(false);
  });

  it("keeps valid persisted values and clamps the top offset", () => {
    expect(parseMapUiPreferences({
      showGrid: false, dockCollapsed: true, dockY: -200,
      sections: { maps: false, tokens: true, drawing: false },
    })).toEqual({
      showGrid: false, dockCollapsed: true, dockY: 70,
      sections: { maps: false, tokens: true, drawing: false },
    });
  });

  it("falls back for malformed storage", () => {
    expect(loadMapUiPreferences({ getItem: () => "{broken", setItem: () => undefined }, "key"))
      .toEqual(DEFAULT_MAP_UI_PREFERENCES);
  });
});
