import { parseRole } from "@/lib/domain/roles";
import type { PlayerOverride, PlayerOverrides } from "@/lib/domain/player";

const stringFields = [
  "name",
  "area",
  "role",
  "squadron",
  "status",
  "ampel",
  "homeLocation",
  "icon",
] as const satisfies readonly (keyof Omit<PlayerOverride, "appRole" | "lastSheetAppRole">)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlayerOverrides(value: unknown): PlayerOverrides {
  if (!isRecord(value)) return {};

  const overrides: PlayerOverrides = {};
  for (const [playerId, candidate] of Object.entries(value)) {
    if (!isRecord(candidate)) continue;

    const override: PlayerOverride = {};
    for (const field of stringFields) {
      if (typeof candidate[field] === "string") override[field] = candidate[field];
    }
    if (candidate.appRole !== undefined) override.appRole = parseRole(candidate.appRole);
    if (candidate.lastSheetAppRole !== undefined) {
      override.lastSheetAppRole = parseRole(candidate.lastSheetAppRole);
    }
    if (Object.keys(override).length > 0) overrides[playerId] = override;
  }
  return overrides;
}
