import { NextResponse } from "next/server";
import { parsePlayerStatusAction, type PlayerStatus } from "@/lib/player-status/model";
import type { RoomMember } from "@/lib/server/room-login";
import { RoomAuthError } from "@/lib/server/room-auth";
import {
  PlayerStatusStoreError,
  type ChangePlayerStatusInput,
} from "@/lib/server/player-status-store";

type Context = { params: Promise<{ roomId: string; playerId: string }> };
type Dependencies = {
  requireMember: (request: Request, roomId: string) => Promise<RoomMember>;
  changeStatus: (input: ChangePlayerStatusInput) => Promise<{ status: PlayerStatus }>;
  now: () => number;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createPlayerStatusHandler(dependencies: Dependencies) {
  return async function POST(request: Request, context: Context) {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return json({ error: "Ungültige Anfrage." }, 400);
    const record = body as Record<string, unknown>;
    const action = parsePlayerStatusAction(record.action);
    const expectedRevision = record.expectedRevision;
    if (!action || (expectedRevision !== undefined
      && (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0))) {
      return json({ error: "Ungültige Statusaktion." }, 400);
    }

    const { roomId, playerId } = await context.params;
    try {
      const member = await dependencies.requireMember(request, roomId);
      const result = await dependencies.changeStatus({
        roomId,
        targetPlayerId: playerId,
        actor: { playerId: member.playerId, role: member.role, via: "desktop" },
        action,
        ...(expectedRevision === undefined ? {} : { expectedRevision: expectedRevision as number }),
        nowMs: dependencies.now(),
      });
      return json(result);
    } catch (error) {
      if (error instanceof RoomAuthError) {
        return json({ error: "Nicht erlaubt." }, error.code === "UNAUTHENTICATED" ? 401 : 403);
      }
      if (error instanceof PlayerStatusStoreError) {
        if (error.code === "FORBIDDEN") return json({ error: "Nicht erlaubt." }, 403);
        if (error.code === "REVISION_CONFLICT") return json({ error: "Status wurde bereits geändert.", status: error.currentStatus }, 409);
        if (error.code === "INVALID_SPAWN" || error.code === "SYSTEM_UNASSIGNED") {
          return json({ error: error.code === "SYSTEM_UNASSIGNED" ? "Spieler ist keinem System zugeordnet." : "Spawnpunkt ist nicht erlaubt." }, 422);
        }
        if (error.code === "BOARD_NOT_FOUND") return json({ error: "Lageboard nicht gefunden." }, 404);
      }
      return json({ error: "Status konnte nicht gespeichert werden." }, 500);
    }
  };
}

export async function POST(request: Request, context: Context) {
  const [{ requireRoomMember }, { createProductionPlayerStatusStore }, { changePlayerStatus }] = await Promise.all([
    import("@/lib/server/room-auth-production"),
    import("@/lib/server/player-status-store-production"),
    import("@/lib/server/player-status-store"),
  ]);
  return createPlayerStatusHandler({
    requireMember: (incoming, roomId) => requireRoomMember(incoming, roomId, { freshRole: true }),
    changeStatus: (input) => changePlayerStatus(createProductionPlayerStatusStore(), input),
    now: Date.now,
  })(request, context);
}
