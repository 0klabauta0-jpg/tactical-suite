import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_UI_PREFERENCES, loadMapUiPreferences, parseMapUiPreferences, saveMapUiPreferences } from "@/lib/map/ui-preferences";

describe("map UI preferences", () => {
  it("starts with a visible grid and compact dock sections", () => {
    expect(parseMapUiPreferences(undefined)).toEqual(DEFAULT_MAP_UI_PREFERENCES);
    expect(DEFAULT_MAP_UI_PREFERENCES.showGrid).toBe(true);
    expect(DEFAULT_MAP_UI_PREFERENCES.dockCollapsed).toBe(false);
    expect(DEFAULT_MAP_UI_PREFERENCES.sections).toEqual({ maps: false, tokens: false, enemy: false, drawing: false });
  });

  it("keeps valid persisted values and clamps the top offset", () => {
    expect(parseMapUiPreferences({
      showGrid: false, dockCollapsed: true, dockY: -200,
      sections: { maps: false, tokens: true, drawing: false },
    })).toEqual({
      showGrid: false, dockCollapsed: true, dockY: 70,
      sections: { maps: false, tokens: true, enemy: false, drawing: false },
    });
  });

  it("falls back for malformed storage", () => {
    expect(loadMapUiPreferences({ getItem: () => "{broken", setItem: () => undefined }, "key"))
      .toEqual(DEFAULT_MAP_UI_PREFERENCES);
  });

  it("keeps an explicit hidden grid per player and restores the default for a new key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    saveMapUiPreferences(storage, "room-a:player-a", { ...DEFAULT_MAP_UI_PREFERENCES, showGrid: false });
    expect(loadMapUiPreferences(storage, "room-a:player-a").showGrid).toBe(false);
    expect(loadMapUiPreferences(storage, "room-b:player-b").showGrid).toBe(true);
  });
});
