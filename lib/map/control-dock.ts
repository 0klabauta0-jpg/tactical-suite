import type { MapControlSections, MapUiPreferences } from "@/lib/map/ui-preferences";

const HEADER_BOTTOM = 70;
const VIEWPORT_PADDING = 8;

export function clampDockY(y: number, viewportHeight: number, dockHeight: number): number {
  const maximum = Math.max(HEADER_BOTTOM, viewportHeight - dockHeight - VIEWPORT_PADDING);
  return Math.min(Math.max(HEADER_BOTTOM, y), maximum);
}

export function toggleDockSection(preferences: MapUiPreferences, section: keyof MapControlSections): MapUiPreferences {
  return { ...preferences, sections: { ...preferences.sections, [section]: !preferences.sections[section] } };
}
