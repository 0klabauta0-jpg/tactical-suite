import { NextResponse } from "next/server";
import { MapSceneStoreError } from "@/lib/server/map-scene-store";
import { RoomAuthError } from "@/lib/server/room-auth";

type Context = { params: Promise<{ roomId: string; sceneId: string; objectId: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, context: Context) {
  const { roomId, sceneId, objectId } = await context.params;
  const [{ requireRoomMember }, { createFirestoreMapSceneStore }, storeModule] = await Promise.all([
    import("@/lib/server/room-auth-production"), import("@/lib/server/firestore-map-scene-store"), import("@/lib/server/map-scene-store"),
  ]);
  try {
    const member = await requireRoomMember(request, roomId, { roles: ["admin", "commander"], freshRole: true });
    return json(await storeModule.acquireSceneObjectLock(createFirestoreMapSceneStore(), {
      roomId, sceneId, objectId, actor: { uid: member.uid, role: member.role }, nowMs: Date.now(),
    }));
  } catch (error) {
    if (error instanceof RoomAuthError) return json({ error: "Nicht erlaubt." }, error.code === "UNAUTHENTICATED" ? 401 : 403);
    if (error instanceof MapSceneStoreError) {
      const status = error.code === "OBJECT_LOCKED" ? 409 : error.code === "FORBIDDEN" || error.code === "FEATURE_DISABLED" ? 403 : 404;
      return json({ error: error.code, object: error.currentObject }, status);
    }
    return json({ error: "Sperre konnte nicht gesetzt werden." }, 500);
  }
}
