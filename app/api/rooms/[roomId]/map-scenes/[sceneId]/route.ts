import { NextResponse } from "next/server";
import { buildRockbreakerEntryUpdate } from "@/lib/release/rockbreaker-entry-rollout";
import { RoomAuthError } from "@/lib/server/room-auth";

type Context = { params: Promise<{ roomId: string; sceneId: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function PUT(request: Request, context: Context) {
  const { roomId, sceneId } = await context.params;
  if (sceneId !== "nyx--rockbreaker") return json({ error: "Ungültige Szene." }, 400);
  const [{ requireRoomMember }, { getAdminFirestore }] = await Promise.all([
    import("@/lib/server/room-auth-production"), import("@/lib/server/firebase-admin"),
  ]);
  try {
    const member = await requireRoomMember(request, roomId, { roles: ["admin"], freshRole: true });
    const metadata = { ...buildRockbreakerEntryUpdate(null), updatedBy: member.uid };
    await getAdminFirestore().doc(`rooms/${roomId}/mapScenes/${sceneId}`).set(metadata, { merge: true });
    return json(metadata);
  } catch (error) {
    if (error instanceof RoomAuthError) return json({ error: "Nicht erlaubt." }, error.code === "UNAUTHENTICATED" ? 401 : 403);
    return json({ error: "Szene konnte nicht initialisiert werden." }, 500);
  }
}
