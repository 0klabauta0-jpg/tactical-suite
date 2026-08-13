import type { Vec3, WorldPoint } from "@/lib/rockbreaker/coordinates";
import type { SceneObject, StrokeSceneObject } from "@/lib/rockbreaker/scene-objects";

type PositionedSceneObject = Extract<SceneObject, { position: WorldPoint }>;
type Locked<T extends SceneObject> = T & { lockRevision?: number };

export async function releasePositionDrag<T extends PositionedSceneObject>(
  operationStart: T,
  position: WorldPoint,
  dependencies: {
    lock: () => Promise<Locked<SceneObject>>;
    write: (operationStart: T, position: WorldPoint, expectedRevision: number, expectedLockRevision: number) => Promise<unknown>;
  },
): Promise<void> {
  const locked = await dependencies.lock();
  if (!("position" in locked)) throw new Error("Objekt besitzt keine Position.");
  await dependencies.write(operationStart, position, operationStart.revision, locked.lockRevision ?? 0);
}

export async function releaseStrokeDrag(
  operationStart: StrokeSceneObject,
  translation: Vec3,
  dependencies: {
    lock: () => Promise<Locked<SceneObject>>;
    write: (operationStart: StrokeSceneObject, translation: Vec3, expectedRevision: number, expectedLockRevision: number) => Promise<unknown>;
  },
): Promise<void> {
  const locked = await dependencies.lock();
  if (locked.type !== "stroke") throw new Error("Zeichnung ist nicht mehr verfügbar.");
  await dependencies.write(operationStart, translation, operationStart.revision, locked.lockRevision ?? 0);
}
