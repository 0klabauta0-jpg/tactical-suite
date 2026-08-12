import { NextResponse } from "next/server";
import { parseWorldPoint } from "@/lib/rockbreaker/scene-objects";
import type { SceneObjectDraft } from "@/lib/server/map-scene-store";
import { MapSceneStoreError } from "@/lib/server/map-scene-store";
import { RoomAuthError } from "@/lib/server/room-auth";

type Context = { params: Promise<{ roomId: string; sceneId: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function draft(value: unknown): SceneObjectDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const position = parseWorldPoint(record.position);
  if (!position || typeof record.color !== "string") return null;
  if ((record.type === "groupToken" || record.type === "orderMarker") && typeof record.groupId === "string" && record.groupId) {
    return { type: record.type, groupId: record.groupId, color: record.color, position };
  }
  if (record.type === "enemyMarker" && (record.kind === "infantry" || record.kind === "ground" || record.kind === "air")) {
    return { type: "enemyMarker", kind: record.kind, color: record.color, position };
  }
  if (record.type === "point") return { type: "point", ...(typeof record.label === "string" ? { label: record.label } : {}), color: record.color, position };
  return null;
}

export async function POST(request: Request, context: Context) {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const parsedDraft = draft(body);
  if (!parsedDraft) return json({ error: "Ungültiges Szenenobjekt." }, 400);
  const { roomId, sceneId } = await context.params;
  const [{ requireRoomMember }, { createFirestoreMapSceneStore }, storeModule] = await Promise.all([
    import("@/lib/server/room-auth-production"), import("@/lib/server/firestore-map-scene-store"), import("@/lib/server/map-scene-store"),
  ]);
  try {
    const member = await requireRoomMember(request, roomId, { roles: ["admin", "commander"], freshRole: true });
    return json(await storeModule.createSceneObject(createFirestoreMapSceneStore(), {
      roomId, sceneId, actor: { uid: member.uid, role: member.role }, draft: parsedDraft, nowMs: Date.now(),
    }), 201);
  } catch (error) {
    if (error instanceof RoomAuthError) return json({ error: "Nicht erlaubt." }, error.code === "UNAUTHENTICATED" ? 401 : 403);
    if (error instanceof MapSceneStoreError) return json({ error: error.code }, error.code === "FORBIDDEN" || error.code === "FEATURE_DISABLED" ? 403 : error.code === "PROTECTED_OBJECT" ? 409 : 400);
    return json({ error: "Objekt konnte nicht erstellt werden." }, 500);
  }
}
