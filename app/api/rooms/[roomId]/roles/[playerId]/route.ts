import { NextResponse } from "next/server";
import type { Role } from "@/lib/domain/roles";
import type { RoomMember } from "@/lib/server/room-login";
import { RoomAuthError } from "@/lib/server/room-auth";

type Context = { params: Promise<{ roomId: string; playerId: string }> };
type Dependencies = {
  requireAdmin: (request: Request, roomId: string) => Promise<RoomMember>;
  setRole: (input: { roomId: string; playerId: string; role: Role; updatedBy: string }) => Promise<void>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createRoomRoleHandlers(dependencies: Dependencies) {
  return {
    PUT: async (request: Request, context: Context) => {
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
      const role = typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>).role : undefined;
      if (role !== "admin" && role !== "commander" && role !== "viewer") return json({ error: "Ungültige Rolle." }, 400);
      const { roomId, playerId } = await context.params;
      try {
        const admin = await dependencies.requireAdmin(request, roomId);
        await dependencies.setRole({ roomId, playerId, role, updatedBy: admin.uid });
        return json({ playerId, role });
      } catch (error) {
        if (error instanceof RoomAuthError) return json({ error: "Nicht erlaubt." }, error.code === "UNAUTHENTICATED" ? 401 : 403);
        return json({ error: "Rolle konnte nicht gespeichert werden." }, 500);
      }
    },
  };
}

async function productionHandlers() {
  const [{ requireRoomMember }, { getAdminFirestore }] = await Promise.all([
    import("@/lib/server/room-auth-production"),
    import("@/lib/server/firebase-admin"),
  ]);
  return createRoomRoleHandlers({
    requireAdmin: (request, roomId) => requireRoomMember(request, roomId, { roles: ["admin"], freshRole: true }),
    setRole: async ({ roomId, playerId, role, updatedBy }) => {
      const { FieldValue } = await import("firebase-admin/firestore");
      await getAdminFirestore().doc(`rooms/${roomId}/roles/${playerId}`).set({
        role,
        updatedBy,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    },
  });
}

export async function PUT(request: Request, context: Context) {
  return (await productionHandlers()).PUT(request, context);
}
