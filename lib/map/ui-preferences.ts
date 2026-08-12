export type MapControlSections = { maps: boolean; tokens: boolean; enemy: boolean; drawing: boolean };
export type MapUiPreferences = {
  showGrid: boolean;
  dockCollapsed: boolean;
  dockY: number;
  sections: MapControlSections;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_MAP_UI_PREFERENCES: MapUiPreferences = {
  showGrid: true,
  dockCollapsed: false,
  dockY: 70,
  sections: { maps: false, tokens: false, enemy: false, drawing: false },
};

function defaults(): MapUiPreferences {
  return { ...DEFAULT_MAP_UI_PREFERENCES, sections: { ...DEFAULT_MAP_UI_PREFERENCES.sections } };
}

export function parseMapUiPreferences(value: unknown): MapUiPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return defaults();
  const record = value as Record<string, unknown>;
  const sections = typeof record.sections === "object" && record.sections !== null && !Array.isArray(record.sections)
    ? record.sections as Record<string, unknown> : {};
  return {
    showGrid: typeof record.showGrid === "boolean" ? record.showGrid : true,
    dockCollapsed: typeof record.dockCollapsed === "boolean" ? record.dockCollapsed : false,
    dockY: typeof record.dockY === "number" && Number.isFinite(record.dockY) ? Math.max(70, record.dockY) : 70,
    sections: {
      maps: typeof sections.maps === "boolean" ? sections.maps : false,
      tokens: typeof sections.tokens === "boolean" ? sections.tokens : false,
      enemy: typeof sections.enemy === "boolean" ? sections.enemy : false,
      drawing: typeof sections.drawing === "boolean" ? sections.drawing : false,
    },
  };
}

export function loadMapUiPreferences(storage: StorageLike, key: string): MapUiPreferences {
  try { return parseMapUiPreferences(JSON.parse(storage.getItem(key) ?? "null")); }
  catch { return defaults(); }
}

export function saveMapUiPreferences(storage: StorageLike, key: string, value: MapUiPreferences): void {
  storage.setItem(key, JSON.stringify(parseMapUiPreferences(value)));
}
