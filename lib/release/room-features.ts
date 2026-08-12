import type { RoomFeatures } from "@/lib/rooms/config";

type FeatureName = keyof RoomFeatures;

export function requireConfirmedRoomApply(roomId: string, apply: boolean, confirmedRoom: string | undefined) {
  if (apply && confirmedRoom !== roomId) {
    throw new Error("Apply requires --confirm-room with the exact same room ID.");
  }
}

export function buildRoomFeatureUpdate(
  current: RoomFeatures,
  assignments: string,
  rockbreakerPermissionApproved: boolean,
) {
  const update: Partial<Record<`features.${FeatureName}`, boolean>> = {};
  const after = { ...current };
  const parts = assignments.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("At least one feature assignment is required.");
  for (const part of parts) {
    const [rawName, rawValue, ...extra] = part.split("=");
    if (extra.length > 0 || (rawName !== "mobileStatus" && rawName !== "rockbreaker3d")) {
      throw new Error(`Unknown feature assignment: ${part}`);
    }
    if (rawValue !== "true" && rawValue !== "false") throw new Error(`Feature value must be true or false: ${part}`);
    const value = rawValue === "true";
    if (rawName === "rockbreaker3d" && value && !rockbreakerPermissionApproved) {
      throw new Error("Rockbreaker cannot be enabled while public redistribution permission is pending.");
    }
    update[`features.${rawName}`] = value;
    after[rawName] = value;
  }
  return { update, after };
}
