import { NextResponse } from "next/server";
import type { RoomMember } from "@/lib/server/room-login";
import { RoomAuthError } from "@/lib/server/room-auth";
import { MobileLinkStoreError } from "@/lib/server/mobile-link-store";

const MOBILE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
type Context = { params: Promise<{ roomId: string }> };
type Dependencies = {
  requireMember: (request: Request, roomId: string) => Promise<RoomMember>;
  issue: (input: { roomId: string; playerId: string; nowMs: number; ttlMs: number }) => Promise<{ token: string; sessionRevision: number; expiresAtMs: number }>;
  revoke: (input: { roomId: string; playerId: string; nowMs: number }) => Promise<{ sessionRevision: number }>;
  appOrigin: URL;
  now: () => number;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  if (error instanceof RoomAuthError) return json({ error: "Nicht erlaubt." }, error.code === "UNAUTHENTICATED" ? 401 : 403);
  if (error instanceof MobileLinkStoreError && error.code === "FEATURE_DISABLED") {
    return json({ error: "Handy-Verbindung ist für diesen Raum nicht aktiviert." }, 404);
  }
  return json({ error: "Handy-Verbindung konnte nicht geändert werden." }, 500);
}

export function createMobileLinkHandlers(dependencies: Dependencies) {
  return {
    POST: async (request: Request, context: Context) => {
      const { roomId } = await context.params;
      try {
        const member = await dependencies.requireMember(request, roomId);
        const issued = await dependencies.issue({
          roomId, playerId: member.playerId, nowMs: dependencies.now(), ttlMs: MOBILE_LINK_TTL_MS,
        });
        const url = new URL("/connect", dependencies.appOrigin);
        url.hash = new URLSearchParams({ r: roomId, p: member.playerId, t: issued.token }).toString();
        return json({ url: url.toString(), expiresAtMs: issued.expiresAtMs, sessionRevision: issued.sessionRevision });
      } catch (error) { return failure(error); }
    },
    DELETE: async (request: Request, context: Context) => {
      const { roomId } = await context.params;
      try {
        const member = await dependencies.requireMember(request, roomId);
        return json(await dependencies.revoke({ roomId, playerId: member.playerId, nowMs: dependencies.now() }));
      } catch (error) { return failure(error); }
    },
  };
}

async function productionHandlers() {
  const [{ requireRoomMember }, { createProductionMobileLinkStore }, storeModule, { getAppOrigin }] = await Promise.all([
    import("@/lib/server/room-auth-production"),
    import("@/lib/server/mobile-link-store-production"),
    import("@/lib/server/mobile-link-store"),
    import("@/lib/server/env"),
  ]);
  const store = createProductionMobileLinkStore();
  return createMobileLinkHandlers({
    requireMember: (request, roomId) => requireRoomMember(request, roomId),
    issue: (input) => storeModule.issueMobileLink(store, input),
    revoke: (input) => storeModule.revokeMobileLink(store, input),
    appOrigin: getAppOrigin(),
    now: Date.now,
  });
}

export async function POST(request: Request, context: Context) {
  return (await productionHandlers()).POST(request, context);
}

export async function DELETE(request: Request, context: Context) {
  return (await productionHandlers()).DELETE(request, context);
}
