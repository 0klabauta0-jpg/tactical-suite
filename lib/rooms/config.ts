export type RoomConfig = {
  sheetUrl: string;
  roomName?: string;
  sheetShareUrl?: string;
  features: RoomFeatures;
};

export type RoomFeatures = {
  rockbreaker3d: boolean;
  mobileStatus: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRoomConfig(value: unknown): RoomConfig | null {
  if (!isRecord(value)) return null;

  const sheetUrl = typeof value.sheetUrl === "string" ? value.sheetUrl.trim() : "";
  if (!sheetUrl) return null;

  const features = isRecord(value.features) ? value.features : {};

  return {
    sheetUrl,
    ...(typeof value.roomName === "string" ? { roomName: value.roomName } : {}),
    ...(typeof value.sheetShareUrl === "string" ? { sheetShareUrl: value.sheetShareUrl } : {}),
    features: {
      rockbreaker3d: features.rockbreaker3d === true,
      mobileStatus: features.mobileStatus === true,
    },
  };
}
