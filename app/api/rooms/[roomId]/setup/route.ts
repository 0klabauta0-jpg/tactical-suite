import { NextResponse } from "next/server";

export class RoomSetupError extends Error {
  constructor(public readonly code: "UNAUTHORIZED" | "ROOM_EXISTS" | "ADMIN_NOT_FOUND" | "PLAYER_SOURCE_UNAVAILABLE") {
    super(code);
  }
}

type SetupInput = {
  roomId: string;
  setupSecret: string;
  sheetUrl: string;
  password: string;
  roomName: string;
  sheetShareUrl: string;
  adminHandle: string;
  nowMs: number;
};

type Dependencies = {
  setup: (input: SetupInput) => Promise<{ roomName: string; adminPlayerId: string }>;
  now: () => number;
};

type Context = { params: Promise<{ roomId: string }> };

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createRoomSetupHandler(dependencies: Dependencies) {
  return async function setupRoom(request: Request, context: Context) {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return json({ error: "Ungültige Anfrage." }, 400);
    const record = body as Record<string, unknown>;
    const required = ["setupSecret", "sheetUrl", "password", "roomName", "adminHandle"] as const;
    if (required.some((key) => typeof record[key] !== "string" || !(record[key] as string).trim())) {
      return json({ error: "Alle Pflichtfelder müssen ausgefüllt sein." }, 400);
    }
    if (!(record.sheetUrl as string).startsWith("http")) return json({ error: "Ungültige Sheet-URL." }, 400);
    const { roomId } = await context.params;
    try {
      const result = await dependencies.setup({
        roomId,
        setupSecret: record.setupSecret as string,
        sheetUrl: (record.sheetUrl as string).trim(),
        password: record.password as string,
        roomName: (record.roomName as string).trim(),
        sheetShareUrl: typeof record.sheetShareUrl === "string" ? record.sheetShareUrl.trim() : "",
        adminHandle: (record.adminHandle as string).trim(),
        nowMs: dependencies.now(),
      });
      return json(result, 201);
    } catch (error) {
      if (error instanceof RoomSetupError) {
        if (error.code === "UNAUTHORIZED") return json({ error: "Setup nicht autorisiert." }, 401);
        if (error.code === "ROOM_EXISTS") return json({ error: "Raum ist bereits eingerichtet." }, 409);
        if (error.code === "ADMIN_NOT_FOUND") return json({ error: "Admin-Handle wurde im Sheet nicht gefunden." }, 422);
        return json({ error: "Spielerliste ist momentan nicht verfügbar." }, 503);
      }
      console.error("[KlabsCom] room setup failed", { roomId, error: error instanceof Error ? error.name : "unknown" });
      return json({ error: "Setup momentan nicht möglich." }, 500);
    }
  };
}

export async function POST(request: Request, context: Context) {
  const { setupRoomProduction } = await import("@/lib/server/room-setup-production");
  return createRoomSetupHandler({ setup: setupRoomProduction, now: Date.now })(request, context);
}
