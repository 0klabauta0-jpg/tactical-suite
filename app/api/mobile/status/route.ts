import { NextResponse } from "next/server";
import { parsePlayerStatusAction, type PlayerStatus } from "@/lib/player-status/model";
import type { ChangePlayerStatusInput } from "@/lib/server/player-status-store";
import { PlayerStatusStoreError } from "@/lib/server/player-status-store";
import type { MobileStatusContext } from "@/lib/server/mobile-session-context";

export type { MobileStatusContext } from "@/lib/server/mobile-session-context";

type Dependencies = {
  getContext: (request: Request) => Promise<MobileStatusContext>;
  changeStatus: (input: ChangePlayerStatusInput) => Promise<{ status: PlayerStatus }>;
  appOrigin: URL;
  now: () => number;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function view(context: MobileStatusContext) {
  return {
    roomName: context.roomName,
    playerName: context.playerName,
    status: context.status,
    spawns: context.spawns,
    systemUnassigned: context.systemUnassigned,
  };
}

export function createMobileStatusHandlers(dependencies: Dependencies) {
  return {
    GET: async (request: Request) => {
      try { return json(view(await dependencies.getContext(request))); }
      catch { return json({ error: "Verbindung ungültig oder widerrufen." }, 401); }
    },
    POST: async (request: Request) => {
      if (request.headers.get("origin") !== dependencies.appOrigin.origin) return json({ error: "Nicht erlaubt." }, 403);
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
      try {
        const context = await dependencies.getContext(request);
        return json(await dependencies.changeStatus({
          roomId: context.roomId,
          targetPlayerId: context.playerId,
          actor: { playerId: context.playerId, role: "viewer", via: "mobile" },
          action,
          ...(expectedRevision === undefined ? {} : { expectedRevision: expectedRevision as number }),
          nowMs: dependencies.now(),
        }));
      } catch (error) {
        if (error instanceof PlayerStatusStoreError) {
          if (error.code === "REVISION_CONFLICT") return json({ error: "Status wurde bereits geändert.", status: error.currentStatus }, 409);
          if (error.code === "INVALID_SPAWN" || error.code === "SYSTEM_UNASSIGNED") return json({ error: "Spawnpunkt ist nicht erlaubt." }, 422);
        }
        return json({ error: "Verbindung ungültig oder widerrufen." }, 401);
      }
    },
  };
}

async function productionHandlers() {
  const [{ getMobileSessionContext }, { createProductionPlayerStatusStore }, storeModule, { getAppOrigin }] = await Promise.all([
    import("@/lib/server/mobile-session-context"),
    import("@/lib/server/player-status-store-production"),
    import("@/lib/server/player-status-store"),
    import("@/lib/server/env"),
  ]);
  const store = createProductionPlayerStatusStore();
  return createMobileStatusHandlers({
    getContext: getMobileSessionContext,
    changeStatus: (input) => storeModule.changePlayerStatus(store, input),
    appOrigin: getAppOrigin(),
    now: Date.now,
  });
}

export async function GET(request: Request) {
  return (await productionHandlers()).GET(request);
}

export async function POST(request: Request) {
  return (await productionHandlers()).POST(request);
}
