import { NextResponse } from "next/server";
import { RoomLoginError } from "@/lib/server/room-login";

type LoginResult = {
  customToken: string;
  player: { id: string; name: string; role: "admin" | "commander" | "viewer" };
  room: { name: string; features: { mobileStatus: boolean; rockbreaker3d: boolean } };
  legacyAuth: boolean;
};

type Dependencies = {
  authenticate: (input: { roomId: string; handle: string; password: string; nowMs: number }) => Promise<LoginResult>;
  now: () => number;
};

type Context = { params: Promise<{ roomId: string }> };

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createRoomLoginHandler(dependencies: Dependencies) {
  return async function roomLogin(request: Request, context: Context) {
    let body: unknown;
    try { body = await request.json(); } catch { return response({ error: "Ungültige Anfrage." }, 400); }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return response({ error: "Ungültige Anfrage." }, 400);
    }
    const record = body as Record<string, unknown>;
    if (typeof record.handle !== "string" || !record.handle.trim()
      || typeof record.password !== "string" || !record.password) {
      return response({ error: "Ungültige Anfrage." }, 400);
    }
    const { roomId } = await context.params;
    try {
      return response(await dependencies.authenticate({
        roomId,
        handle: record.handle,
        password: record.password,
        nowMs: dependencies.now(),
      }));
    } catch (error) {
      if (error instanceof RoomLoginError) {
        if (error.code === "ROOM_NOT_FOUND") return response({ error: "Raum nicht gefunden." }, 404);
        if (error.code === "PLAYER_SOURCE_UNAVAILABLE") {
          return response({ error: "Spielerliste ist momentan nicht verfügbar." }, 503);
        }
        return response({ error: "Anmeldung fehlgeschlagen." }, 401);
      }
      console.error("[KlabsCom] room login failed", { roomId, error: error instanceof Error ? error.name : "unknown" });
      return response({ error: "Anmeldung momentan nicht möglich." }, 500);
    }
  };
}

export async function POST(request: Request, context: Context) {
  const { authenticateRoomPlayerProduction } = await import("@/lib/server/room-login-production");
  return createRoomLoginHandler({ authenticate: authenticateRoomPlayerProduction, now: Date.now })(request, context);
}
