import { NextResponse } from "next/server";
import { MOBILE_SESSION_COOKIE, mobileSessionCookieOptions, type MobileSessionPayload } from "@/lib/mobile-link/session";
import { MobileLinkStoreError, type MobileLinkRecord } from "@/lib/server/mobile-link-store";

type ConnectInput = { roomId: string; playerId: string; token: string };
type Dependencies = {
  verifyLink: (input: ConnectInput & { nowMs: number }) => Promise<MobileLinkRecord>;
  createSession: (input: Omit<MobileSessionPayload, "v">) => string;
  now: () => number;
  environment: string | undefined;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createMobileConnectHandler(dependencies: Dependencies) {
  return async function POST(request: Request) {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Verbindung ungültig oder widerrufen." }, 400); }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return json({ error: "Verbindung ungültig oder widerrufen." }, 400);
    const record = body as Record<string, unknown>;
    if (typeof record.roomId !== "string" || !record.roomId || record.roomId.length > 128
      || typeof record.playerId !== "string" || !record.playerId || record.playerId.length > 256
      || typeof record.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(record.token)) {
      return json({ error: "Verbindung ungültig oder widerrufen." }, 400);
    }
    const nowMs = dependencies.now();
    try {
      const link = await dependencies.verifyLink({
        roomId: record.roomId, playerId: record.playerId, token: record.token, nowMs,
      });
      const expiresAtMs = Math.min(link.expiresAtMs, nowMs + 30 * 24 * 60 * 60 * 1000);
      const session = dependencies.createSession({
        roomId: record.roomId,
        playerId: record.playerId,
        sessionRevision: link.sessionRevision,
        issuedAtMs: nowMs,
        expiresAtMs,
      });
      const response = json({ redirectTo: "/mobile/status" });
      response.cookies.set(
        MOBILE_SESSION_COOKIE,
        session,
        mobileSessionCookieOptions(dependencies.environment, Math.max(1, Math.floor((expiresAtMs - nowMs) / 1000))),
      );
      return response;
    } catch (error) {
      const status = error instanceof MobileLinkStoreError && error.code === "FEATURE_DISABLED" ? 404 : 401;
      return json({ error: "Verbindung ungültig oder widerrufen." }, status);
    }
  };
}

export async function POST(request: Request) {
  const [{ getAdminFirestore }, { verifyMobileLink }, { createMobileSession }, { getMobileSessionSecret }] = await Promise.all([
    import("@/lib/server/firebase-admin"),
    import("@/lib/server/mobile-link-store"),
    import("@/lib/mobile-link/session"),
    import("@/lib/server/env"),
  ]);
  const firestore = getAdminFirestore();
  return createMobileConnectHandler({
    verifyLink: (input) => verifyMobileLink({
      getRoomConfig: async (roomId) => {
        const snapshot = await firestore.doc(`rooms/${roomId}/config/main`).get();
        return snapshot.exists ? snapshot.data() : null;
      },
      getLink: async (roomId, playerId) => {
        const snapshot = await firestore.doc(`rooms/${roomId}/mobileLinks/${playerId}`).get();
        return snapshot.exists ? snapshot.data() : null;
      },
    }, input),
    createSession: (input) => createMobileSession(input, getMobileSessionSecret()),
    now: Date.now,
    environment: process.env.NODE_ENV,
  })(request);
}
