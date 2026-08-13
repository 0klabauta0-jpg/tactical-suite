import { NextResponse } from "next/server";
import { parseWorldPoint } from "@/lib/rockbreaker/scene-objects";
import type { Vec3 } from "@/lib/rockbreaker/coordinates";
import { MapSceneStoreError } from "@/lib/server/map-scene-store";
import { RoomAuthError } from "@/lib/server/room-auth";

type Context = { params: Promise<{ roomId: string; sceneId: string; objectId: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function dependencies(request: Request, roomId: string) {
  const [{ requireRoomMember }, { createFirestoreMapSceneStore }, storeModule] = await Promise.all([
    import("@/lib/server/room-auth-production"), import("@/lib/server/firestore-map-scene-store"), import("@/lib/server/map-scene-store"),
  ]);
  const member = await requireRoomMember(request, roomId, { roles: ["admin", "commander"], freshRole: true });
  return { member, store: createFirestoreMapSceneStore(), storeModule };
}

export async function PATCH(request: Request, context: Context) {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const hasPosition = "position" in record;
  const hasTranslation = "translation" in record;
  const position = hasPosition ? parseWorldPoint(record.position) : null;
  const translation = hasTranslation && Array.isArray(record.translation)
    && record.translation.length === 3 && record.translation.every((value) => typeof value === "number" && Number.isFinite(value))
    ? record.translation as unknown as Vec3
    : null;
  if (hasPosition === hasTranslation || (!position && !translation)
    || !Number.isInteger(record.expectedRevision) || !Number.isInteger(record.expectedLockRevision)) return json({ error: "Ungültige Anfrage." }, 400);
  const { roomId, sceneId, objectId } = await context.params;
  try {
    const { member, store, storeModule } = await dependencies(request, roomId);
    const input = {
      roomId, sceneId, objectId, actor: { uid: member.uid, role: member.role },
      expectedRevision: record.expectedRevision as number, expectedLockRevision: record.expectedLockRevision as number,
      nowMs: Date.now(),
    };
    return json(position
      ? await storeModule.commitSceneObjectMove(store, { ...input, position })
      : await storeModule.commitSceneObjectTranslation(store, { ...input, translation: translation! }));
  } catch (error) {
    if (error instanceof RoomAuthError) return json({ error: "Nicht erlaubt." }, error.code === "UNAUTHENTICATED" ? 401 : 403);
    if (error instanceof MapSceneStoreError) {
      const status = error.code === "OBJECT_LOCKED" || error.code === "REVISION_CONFLICT" || error.code === "LOCK_MISMATCH"
        ? 409
        : error.code === "FORBIDDEN" || error.code === "FEATURE_DISABLED" ? 403
          : error.code === "OUT_OF_BOUNDS" || error.code === "INVALID_OBJECT" ? 400 : 404;
      return json({ error: error.code, object: error.currentObject }, status);
    }
    return json({ error: "Objekt konnte nicht verschoben werden." }, 500);
  }
}

export async function DELETE(request: Request, context: Context) {
  const { roomId, sceneId, objectId } = await context.params;
  try {
    const { member, store, storeModule } = await dependencies(request, roomId);
    await storeModule.deleteSceneObject(store, { roomId, sceneId, objectId, actor: { uid: member.uid, role: member.role } });
    return json({ deleted: true });
  } catch (error) {
    if (error instanceof RoomAuthError) return json({ error: "Nicht erlaubt." }, error.code === "UNAUTHENTICATED" ? 401 : 403);
    if (error instanceof MapSceneStoreError) return json({ error: error.code }, error.code === "FORBIDDEN" || error.code === "FEATURE_DISABLED" ? 403 : error.code === "PROTECTED_OBJECT" ? 409 : 404);
    return json({ error: "Objekt konnte nicht gelöscht werden." }, 500);
  }
}
