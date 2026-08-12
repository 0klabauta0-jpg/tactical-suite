import { NextResponse } from "next/server";
import { parseTokenTransferCommand, type TokenTransferResult } from "@/lib/map/token-transfer";
import type { RoomMember } from "@/lib/server/room-login";
import { RoomAuthError } from "@/lib/server/room-auth";
import {
  TokenTransferStoreError,
  type ExecuteTokenTransferInput,
} from "@/lib/server/token-transfer-store";

type Context = { params: Promise<{ roomId: string }> };
type Dependencies = {
  requireWriter(request: Request, roomId: string): Promise<RoomMember>;
  transfer(input: ExecuteTokenTransferInput): Promise<TokenTransferResult>;
  now(): number;
};

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export function createTokenTransferHandler(dependencies: Dependencies) {
  return async function POST(request: Request, context: Context) {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
    const command = parseTokenTransferCommand(body);
    if (!command) return json({ error: "Ungültiger Truppentransfer." }, 400);
    const { roomId } = await context.params;
    try {
      const member = await dependencies.requireWriter(request, roomId);
      const result = await dependencies.transfer({
        roomId,
        actor: { uid: member.uid, role: member.role },
        command,
        nowMs: dependencies.now(),
      });
      return json({ result });
    } catch (error) {
      if (error instanceof RoomAuthError) {
        return json({ error: "Nicht erlaubt." }, error.code === "UNAUTHENTICATED" ? 401 : 403);
      }
      if (error instanceof TokenTransferStoreError) {
        switch (error.code) {
          case "FORBIDDEN":
          case "FEATURE_DISABLED":
            return json({ error: "Nicht erlaubt." }, 403);
          case "BOARD_NOT_FOUND":
            return json({ error: "Lageboard nicht gefunden." }, 404);
          case "SOURCE_CONFLICT":
            return json({
              error: "Trupp wurde inzwischen von einem anderen Teilnehmer verschoben.",
              currentLocation: error.currentLocation,
            }, 409);
          case "AMBIGUOUS_SOURCE":
            return json({ error: "Trupp besitzt mehrere gespeicherte Positionen." }, 409);
          case "OPERATION_CONFLICT":
            return json({ error: "Transferkennung wurde bereits anders verwendet." }, 409);
          case "ENTRY_FULL":
            return json({ error: "Der 3D-Einstiegsbereich ist belegt." }, 409);
          case "INVALID_GROUP":
          case "INVALID_TARGET":
            return json({ error: "Ungültiges Transferziel." }, 422);
        }
      }
      return json({ error: "Trupp konnte nicht verschoben werden." }, 500);
    }
  };
}

export async function POST(request: Request, context: Context) {
  const [{ requireRoomMember }, { createProductionTokenTransferStore }, { executeTokenTransfer }] = await Promise.all([
    import("@/lib/server/room-auth-production"),
    import("@/lib/server/token-transfer-store-production"),
    import("@/lib/server/token-transfer-store"),
  ]);
  return createTokenTransferHandler({
    requireWriter: (incoming, roomId) => requireRoomMember(incoming, roomId, {
      roles: ["admin", "commander"],
      freshRole: true,
    }),
    transfer: (input) => executeTokenTransfer(createProductionTokenTransferStore(), input),
    now: Date.now,
  })(request, context);
}
