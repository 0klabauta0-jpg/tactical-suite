export type RoomConfig = {
  sheetUrl: string;
  password: string;
  roomName?: string;
  sheetShareUrl?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRoomConfig(value: unknown): RoomConfig | null {
  if (!isRecord(value)) return null;

  const sheetUrl = typeof value.sheetUrl === "string" ? value.sheetUrl.trim() : "";
  if (!sheetUrl || typeof value.password !== "string") return null;

  return {
    sheetUrl,
    password: value.password,
    ...(typeof value.roomName === "string" ? { roomName: value.roomName } : {}),
    ...(typeof value.sheetShareUrl === "string" ? { sheetShareUrl: value.sheetShareUrl } : {}),
  };
}
