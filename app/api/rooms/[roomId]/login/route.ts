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
  consumeAttempt: (input: { roomId: string; handle: string; ipAddress: string; nowMs: number }) => Promise<boolean>;
  resetAttempts: (input: { roomId: string; handle: string; ipAddress: string; nowMs: number }) => Promise<void>;
  now: () => number;
};

type Context = { params: Promise<{ roomId: string }> };

function response(body: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function clientIpAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
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
    const attempt = {
      roomId,
      handle: record.handle,
      ipAddress: clientIpAddress(request),
      nowMs: dependencies.now(),
    };
    try {
      if (!await dependencies.consumeAttempt(attempt)) {
        return response({ error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen." }, 429, { "Retry-After": "900" });
      }
      const result = await dependencies.authenticate({
        roomId,
        handle: record.handle,
        password: record.password,
        nowMs: attempt.nowMs,
      });
      try {
        await dependencies.resetAttempts(attempt);
      } catch (error) {
        console.error("[KlabsCom] login rate-limit reset failed", { roomId, error: error instanceof Error ? error.name : "unknown" });
      }
      return response(result);
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
  const { consumeRoomLoginAttempt, resetRoomLoginAttempts } = await import("@/lib/server/login-rate-limit");
  return createRoomLoginHandler({
    authenticate: authenticateRoomPlayerProduction,
    consumeAttempt: consumeRoomLoginAttempt,
    resetAttempts: resetRoomLoginAttempts,
    now: Date.now,
  })(request, context);
}
