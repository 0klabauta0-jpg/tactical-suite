"use client";

import { useEffect, useRef, useState } from "react";
import type * as Three from "three";
import { ParentLevelDropTarget, TokenDropTarget, tokenDropIntentAtPoint } from "@/app/components/map/token-transfer-controls";
import type { BoardGroup } from "@/lib/board/state";
import { createMapSceneObject, lockMapSceneObject, moveMapSceneObject, removeMapSceneObject, translateMapSceneObject } from "@/lib/map-scene/client";
import { appendStrokeSample, clampStrokeTranslation, simplifyStrokePoints, type RockbreakerDrawingTool, type StrokeSample } from "@/lib/rockbreaker/drawing";
import { loadRockbreakerField } from "@/lib/rockbreaker/field";
import { resolveWorldPoint, worldPointFromHit, type AsteroidHit, type Mat4, type Vec3, type WorldPoint } from "@/lib/rockbreaker/coordinates";
import { confirmedObjectPosition, type RockbreakerStrokeWidth, type SceneObject, type StrokeSceneObject } from "@/lib/rockbreaker/scene-objects";
import { clampCanvasPoint, freeSpaceWorldPoint, intersectCameraDragPlane } from "@/lib/rockbreaker/drag";
import type { SceneObjectDraft } from "@/lib/server/map-scene-store";
import { createRockbreakerObject3d, disposeRockbreakerObject3d } from "@/lib/rockbreaker/three-scene-objects";

export type RockbreakerEnemyKind = "infantry" | "ground" | "air";
type PositionedSceneObject = Extract<SceneObject, { position: WorldPoint }>;
type CameraDragPlane = { point: Vec3; normal: Vec3 };
type PointerOperation =
  | { kind: "orbit"; pointerId: number; x: number; y: number; azimuth: number; elevation: number }
  | { kind: "point-create"; pointerId: number; point: WorldPoint; x: number; y: number }
  | { kind: "position-drag"; pointerId: number; object: PositionedSceneObject; mesh: Three.Object3D; point: WorldPoint; cameraPlane: CameraDragPlane }
  | { kind: "stroke-drag"; pointerId: number; object: StrokeSceneObject; mesh: Three.Object3D; cameraPlane: CameraDragPlane; startHit: Vec3; translation: Vec3 }
  | { kind: "stroke-create"; pointerId: number; samples: StrokeSample[]; cameraPlane: CameraDragPlane; line: Three.Line }
  | { kind: "idle" };

export function RockbreakerMap({
  roomId,
  sceneId,
  groups,
  objects,
  enemyPlacement,
  showGrid,
  canWrite,
  getIdToken,
  onBack,
  onMoveGroupUp,
  onMoveGroupPosition,
  drawingTool,
  drawingColor,
  drawingWidth,
  sceneMutations,
  onPreviewActiveChange,
  initialCameraAzimuth = 0.7,
  dropTargetId = "rockbreaker-scene-drop",
  dropTestId = "rockbreaker-scene-drop",
}: {
  roomId: string;
  sceneId: string;
  groups: BoardGroup[];
  objects: SceneObject[];
  enemyPlacement: RockbreakerEnemyKind | null;
  showGrid: boolean;
  canWrite: boolean;
  getIdToken: () => Promise<string>;
  onBack: () => void;
  onMoveGroupUp: (groupId: string, revision: number) => Promise<void>;
  onMoveGroupPosition?: (object: PositionedSceneObject, position: WorldPoint) => Promise<void>;
  currentUid: string;
  drawingTool: RockbreakerDrawingTool;
  drawingColor: string;
  drawingWidth: RockbreakerStrokeWidth;
  sceneMutations?: {
    create?: (draft: SceneObjectDraft) => Promise<void>;
    remove?: (object: SceneObject) => Promise<void>;
    movePosition?: (object: PositionedSceneObject, position: WorldPoint) => Promise<void>;
    translateStroke?: (object: StrokeSceneObject, translation: Vec3) => Promise<void>;
  };
  onPreviewActiveChange?: (active: boolean) => void;
  initialCameraAzimuth?: number;
  dropTargetId?: string;
  dropTestId?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectsRef = useRef<SceneObject[]>(objects);
  const enemyPlacementRef = useRef<RockbreakerEnemyKind | null>(enemyPlacement);
  const onMoveGroupUpRef = useRef(onMoveGroupUp);
  const onMoveGroupPositionRef = useRef(onMoveGroupPosition);
  const drawingToolRef = useRef(drawingTool);
  const drawingColorRef = useRef(drawingColor);
  const drawingWidthRef = useRef(drawingWidth);
  const sceneMutationsRef = useRef(sceneMutations);
  const onPreviewActiveChangeRef = useRef(onPreviewActiveChange);
  const groupLabelRefs = useRef(new Map<string, HTMLSpanElement>());
  const [sceneReady, setSceneReady] = useState(0);
  const [message, setMessage] = useState("Weltkoordinaten in km");
  const getIdTokenRef = useRef(getIdToken);
  const canWriteRef = useRef(canWrite);
  const showGridRef = useRef(showGrid);
  const initialCameraAzimuthRef = useRef(initialCameraAzimuth);
  const sceneContext = useRef<{
    THREE: typeof import("three");
    scene: Three.Scene;
    camera: Three.PerspectiveCamera;
    renderer: Three.WebGLRenderer;
    grid: Three.GridHelper;
    asteroidMeshes: Three.InstancedMesh[];
    objectRoot: Three.Group;
    objectMeshes: Map<string, Three.Object3D>;
  } | null>(null);

  useEffect(() => { objectsRef.current = objects; }, [objects]);
  useEffect(() => { enemyPlacementRef.current = enemyPlacement; }, [enemyPlacement]);
  useEffect(() => { onMoveGroupUpRef.current = onMoveGroupUp; }, [onMoveGroupUp]);
  useEffect(() => { onMoveGroupPositionRef.current = onMoveGroupPosition; }, [onMoveGroupPosition]);
  useEffect(() => { drawingToolRef.current = drawingTool; }, [drawingTool]);
  useEffect(() => { drawingColorRef.current = drawingColor; }, [drawingColor]);
  useEffect(() => { drawingWidthRef.current = drawingWidth; }, [drawingWidth]);
  useEffect(() => { sceneMutationsRef.current = sceneMutations; }, [sceneMutations]);
  useEffect(() => { onPreviewActiveChangeRef.current = onPreviewActiveChange; }, [onPreviewActiveChange]);
  useEffect(() => { getIdTokenRef.current = getIdToken; }, [getIdToken]);
  useEffect(() => { canWriteRef.current = canWrite; }, [canWrite]);
  useEffect(() => { showGridRef.current = showGrid; if (sceneContext.current) sceneContext.current.grid.visible = showGrid; }, [showGrid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    const cleanupListeners: Array<() => void> = [];

    void import("three").then((THREE) => {
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x05070d);
      const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 8000);
      const cameraState = { azimuth: initialCameraAzimuthRef.current, elevation: 0.42, distance: 55 };
      const updateCamera = () => {
        const horizontal = Math.cos(cameraState.elevation) * cameraState.distance;
        camera.position.set(Math.sin(cameraState.azimuth) * horizontal, Math.sin(cameraState.elevation) * cameraState.distance, Math.cos(cameraState.azimuth) * horizontal);
        camera.lookAt(0, 0, 0);
      };
      updateCamera();
      scene.add(new THREE.AmbientLight(0x52606e, 1.4));
      const sun = new THREE.DirectionalLight(0xffe8cf, 2.2); sun.position.set(20, 30, 15); scene.add(sun);
      const rim = new THREE.DirectionalLight(0x48c7e0, 0.8); rim.position.set(-20, -10, -20); scene.add(rim);
      const grid = new THREE.GridHelper(80, 80, 0x60a5fa, 0x243244); grid.position.y = 0; grid.visible = showGridRef.current; scene.add(grid);
      const station = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.7, 4.2, 12), new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.75, roughness: 0.45 }));
      station.rotation.z = Math.PI / 2; station.userData.station = true; scene.add(station);

      const asteroidMeshes: Three.InstancedMesh[] = [];
      const field = loadRockbreakerField();
      const byMesh = new Map<number, typeof field>();
      for (const asteroid of field) byMesh.set(asteroid.meshIndex, [...(byMesh.get(asteroid.meshIndex) ?? []), asteroid]);
      for (const [meshIndex, asteroids] of byMesh) {
        const geometry = new THREE.IcosahedronGeometry(0.65 + (meshIndex % 4) * 0.08, 1);
        const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.08, 0.08, 0.24 + (meshIndex % 3) * 0.035), roughness: 0.95 });
        const mesh = new THREE.InstancedMesh(geometry, material, asteroids.length);
        const matrix = new THREE.Matrix4();
        asteroids.forEach((asteroid, index) => {
          matrix.compose(new THREE.Vector3(...asteroid.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(index * 0.37, index * 0.19, index * 0.11)), new THREE.Vector3(...asteroid.scale));
          mesh.setMatrixAt(index, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.instanceIds = asteroids.map((asteroid) => asteroid.id);
        asteroidMeshes.push(mesh); scene.add(mesh);
      }

      const objectRoot = new THREE.Group(); scene.add(objectRoot);
      const objectMeshes = new Map<string, Three.Object3D>();
      sceneContext.current = { THREE, scene, camera, renderer, grid, asteroidMeshes, objectRoot, objectMeshes };
      setSceneReady((revision) => revision + 1);

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const setRayAt = (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
      };
      const setRay = (event: PointerEvent) => setRayAt(event.clientX, event.clientY);
      const pointAt = (event: PointerEvent): WorldPoint | null => {
        setRay(event);
        const hits = raycaster.intersectObjects([...asteroidMeshes, station], false);
        const hit = hits[0];
        if (hit?.object instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
          const instance = new THREE.Matrix4(); hit.object.getMatrixAt(hit.instanceId, instance);
          const worldMatrix = new THREE.Matrix4().multiplyMatrices(hit.object.matrixWorld, instance);
          const asteroidHit: AsteroidHit = {
            asteroidId: (hit.object.userData.instanceIds as string[])[hit.instanceId],
            asteroidWorldMatrix: worldMatrix.toArray() as Mat4,
            hitPoint: [hit.point.x, hit.point.y, hit.point.z],
          };
          return worldPointFromHit(asteroidHit);
        }
        return resolveWorldPoint({
          origin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
          direction: [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
        }, null);
      };

      let operation: PointerOperation = { kind: "idle" };
      const disposePreview = () => {
        if (operation.kind !== "stroke-create") return;
        scene.remove(operation.line);
        operation.line.geometry.dispose();
        const materials = Array.isArray(operation.line.material) ? operation.line.material : [operation.line.material];
        materials.forEach((material) => material.dispose());
        operation = { kind: "idle" };
        onPreviewActiveChangeRef.current?.(false);
      };
      const createDraft = async (draft: SceneObjectDraft) => {
        const customCreate = sceneMutationsRef.current?.create;
        if (customCreate) await customCreate(draft);
        else await createMapSceneObject(roomId, sceneId, draft, () => getIdTokenRef.current());
      };
      const removeObject = async (object: SceneObject) => {
        const customRemove = sceneMutationsRef.current?.remove;
        if (customRemove) await customRemove(object);
        else await removeMapSceneObject(roomId, sceneId, object.id, () => getIdTokenRef.current());
      };
      const movePosition = async (object: PositionedSceneObject, position: WorldPoint, lockRevision: number) => {
        const customMove = sceneMutationsRef.current?.movePosition;
        if (customMove) await customMove(object, position);
        else await moveMapSceneObject(roomId, sceneId, object, position, lockRevision, () => getIdTokenRef.current());
      };
      const translateStroke = async (object: StrokeSceneObject, translation: Vec3, lockRevision: number) => {
        const customTranslate = sceneMutationsRef.current?.translateStroke;
        if (customTranslate) await customTranslate(object, translation);
        else await translateMapSceneObject(roomId, sceneId, object, translation, lockRevision, () => getIdTokenRef.current());
      };
      const objectAtPointer = (event: PointerEvent) => {
        setRay(event);
        const objectHit = raycaster.intersectObjects([...objectMeshes.values()], true)
          .find((hit) => hit.object.userData.objectId || hit.object.parent?.userData.objectId);
        const objectId = objectHit ? String(objectHit.object.userData.objectId ?? objectHit.object.parent?.userData.objectId) : "";
        return {
          hit: objectHit,
          object: objectsRef.current.find((candidate) => candidate.id === objectId),
        };
      };
      const down = (event: PointerEvent) => {
        const drawingTool = drawingToolRef.current;
        if (canWriteRef.current && drawingTool === "stroke") {
          const start = pointAt(event);
          if (!start) return;
          event.preventDefault();
          const direction = new THREE.Vector3();
          camera.getWorldDirection(direction);
          const startPoint = freeSpaceWorldPoint(start);
          const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(startPoint.x, startPoint.y, startPoint.z)]);
          const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: drawingColorRef.current }));
          operation = {
            kind: "stroke-create",
            pointerId: event.pointerId,
            line,
            samples: [{ screen: { x: event.clientX, y: event.clientY }, world: startPoint }],
            cameraPlane: {
              point: [startPoint.x, startPoint.y, startPoint.z],
              normal: [direction.x, direction.y, direction.z],
            },
          };
          scene.add(line);
          canvas.setPointerCapture(event.pointerId);
          onPreviewActiveChangeRef.current?.(true);
          return;
        }
        if (canWriteRef.current && drawingTool === "point") {
          const point = pointAt(event);
          if (!point) return;
          event.preventDefault();
          operation = { kind: "point-create", pointerId: event.pointerId, point, x: event.clientX, y: event.clientY };
          canvas.setPointerCapture(event.pointerId);
          return;
        }
        const { hit: objectHit, object } = objectAtPointer(event);
        if (object && canWriteRef.current && drawingTool === "delete") {
          if (object.type !== "point" && object.type !== "stroke") return;
          event.preventDefault();
          void removeObject(object)
            .then(() => setMessage("Zeichnung gelöscht."))
            .catch(() => setMessage("Zeichnung konnte nicht gelöscht werden."));
          return;
        }
        if (object?.type === "stroke" && objectHit && canWriteRef.current && drawingTool === "move") {
          event.preventDefault();
          const mesh = objectMeshes.get(object.id);
          if (!mesh) return;
          const direction = new THREE.Vector3(); camera.getWorldDirection(direction);
          operation = {
            kind: "stroke-drag",
            pointerId: event.pointerId,
            object,
            mesh,
            cameraPlane: { point: [objectHit.point.x, objectHit.point.y, objectHit.point.z], normal: [direction.x, direction.y, direction.z] },
            startHit: [objectHit.point.x, objectHit.point.y, objectHit.point.z],
            translation: [0, 0, 0],
          };
          canvas.setPointerCapture(event.pointerId);
          return;
        }
        if (object && canWriteRef.current && "position" in object) {
          const mayMove = object.type === "groupToken"
            ? drawingTool === "pointer"
            : object.type === "enemyMarker"
              ? drawingTool === "pointer"
              : drawingTool === "move";
          if (!mayMove) return;
          event.preventDefault();
          canvas.setPointerCapture(event.pointerId);
          if (object.type === "groupToken" || object.type === "enemyMarker" || object.type === "point") {
            const mesh = objectMeshes.get(object.id);
            const direction = new THREE.Vector3();
            camera.getWorldDirection(direction);
            if (mesh) operation = {
              kind: "position-drag",
              pointerId: event.pointerId,
              object,
              mesh,
              point: object.position,
              cameraPlane: {
                point: [object.position.x, object.position.y, object.position.z],
                normal: [direction.x, direction.y, direction.z],
              },
            };
            return;
          }
        }
        if (drawingTool !== "pointer") return;
        operation = { kind: "orbit", pointerId: event.pointerId, x: event.clientX, y: event.clientY, azimuth: cameraState.azimuth, elevation: cameraState.elevation };
        canvas.setPointerCapture(event.pointerId);
      };
      const move = (event: PointerEvent) => {
        if (operation.kind === "point-create") return;
        if (operation.kind === "stroke-create") {
          const rect = canvas.getBoundingClientRect();
          const client = clampCanvasPoint({ x: event.clientX, y: event.clientY }, rect);
          setRayAt(client.x, client.y);
          const intersection = intersectCameraDragPlane({
            origin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
            direction: [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
          }, operation.cameraPlane.point, operation.cameraPlane.normal);
          if (!intersection) return;
          operation.samples = appendStrokeSample(operation.samples, {
            screen: client,
            world: freeSpaceWorldPoint(intersection),
          });
          const oldGeometry = operation.line.geometry;
          operation.line.geometry = new THREE.BufferGeometry().setFromPoints(
            operation.samples.map(({ world }) => new THREE.Vector3(world.x, world.y, world.z)),
          );
          oldGeometry.dispose();
          return;
        }
        if (operation.kind === "stroke-drag") {
          const rect = canvas.getBoundingClientRect();
          const client = clampCanvasPoint({ x: event.clientX, y: event.clientY }, rect);
          setRayAt(client.x, client.y);
          const intersection = intersectCameraDragPlane({
            origin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
            direction: [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
          }, operation.cameraPlane.point, operation.cameraPlane.normal);
          if (!intersection) return;
          const desired: Vec3 = [
            intersection[0] - operation.startHit[0],
            intersection[1] - operation.startHit[1],
            intersection[2] - operation.startHit[2],
          ];
          operation.translation = clampStrokeTranslation(operation.object.points, desired);
          operation.mesh.position.set(...operation.translation);
          return;
        }
        if (operation.kind === "position-drag") {
          const point = operation.cameraPlane
            ? (() => {
                const rect = canvas.getBoundingClientRect();
                const client = clampCanvasPoint({ x: event.clientX, y: event.clientY }, rect);
                setRayAt(client.x, client.y);
                const intersection = intersectCameraDragPlane({
                  origin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
                  direction: [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
                }, operation.cameraPlane.point, operation.cameraPlane.normal);
                return intersection ? freeSpaceWorldPoint(intersection) : null;
              })()
            : pointAt(event);
          if (point) { operation.point = point; operation.mesh.position.set(point.x, point.y, point.z); }
          return;
        }
        if (operation.kind === "orbit") {
          cameraState.azimuth = operation.azimuth - (event.clientX - operation.x) * 0.008;
          cameraState.elevation = Math.max(-1.25, Math.min(1.25, operation.elevation + (event.clientY - operation.y) * 0.006));
          updateCamera();
        }
      };
      const up = (event: PointerEvent) => {
        if (operation.kind === "point-create") {
          const pending = operation;
          operation = { kind: "idle" };
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          if (Math.abs(event.clientX - pending.x) < 4 && Math.abs(event.clientY - pending.y) < 4) {
            void createDraft({ type: "point", color: drawingColorRef.current, position: pending.point })
              .then(() => setMessage("3D-Punkt gespeichert."))
              .catch(() => setMessage("Zeichnung konnte nicht gespeichert werden."));
          }
          return;
        }
        if (operation.kind === "stroke-create") {
          const samples = operation.samples;
          disposePreview();
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          const points = simplifyStrokePoints(samples.map(({ world }) => world));
          const first = points[0];
          const distinct = first && points.some((point) => point.x !== first.x || point.y !== first.y || point.z !== first.z);
          if (points.length >= 2 && distinct) {
            void createDraft({ type: "stroke", color: drawingColorRef.current, width: drawingWidthRef.current, points })
              .then(() => setMessage("3D-Zeichnung gespeichert."))
              .catch(() => setMessage("Zeichnung konnte nicht gespeichert werden."));
          }
          return;
        }
        if (operation.kind === "stroke-drag") {
          const current = operation; operation = { kind: "idle" };
          const finish = async () => {
            const customTranslate = sceneMutationsRef.current?.translateStroke;
            if (customTranslate) return customTranslate(current.object, current.translation);
            const locked = await lockMapSceneObject(roomId, sceneId, current.object.id, () => getIdTokenRef.current());
            if (locked.type !== "stroke") throw new Error("Zeichnung ist nicht mehr verfügbar.");
            return translateStroke(locked, current.translation, locked.lockRevision ?? 0);
          };
          void finish()
            .then(() => setMessage("3D-Zeichnung verschoben."))
            .catch((reason) => {
              current.mesh.position.set(0, 0, 0);
              setMessage(reason instanceof Error ? reason.message : "Positionskonflikt – Serverstand übernommen.");
            });
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          return;
        }
        if (operation.kind === "position-drag") {
          const current = operation; operation = { kind: "idle" };
          const dropIntent = tokenDropIntentAtPoint(event.clientX, event.clientY);
          const mutation = current.object.type === "groupToken" && dropIntent?.kind === "moveUp"
            ? onMoveGroupUpRef.current(current.object.groupId, current.object.revision)
            : current.object.type === "groupToken"
              ? onMoveGroupPositionRef.current
                ? onMoveGroupPositionRef.current(current.object, current.point)
                : lockMapSceneObject(roomId, sceneId, current.object.id, () => getIdTokenRef.current()).then((locked) => {
                    if (!("position" in locked)) throw new Error("Truppenmarker besitzt keine Position.");
                    return moveMapSceneObject(roomId, sceneId, locked, current.point, locked.lockRevision ?? 0, () => getIdTokenRef.current());
                  })
              : (() => {
                    const customMove = sceneMutationsRef.current?.movePosition;
                    if (customMove) return customMove(current.object, current.point);
                    return lockMapSceneObject(roomId, sceneId, current.object.id, () => getIdTokenRef.current()).then((locked) => {
                      if (!("position" in locked)) throw new Error("Objekt besitzt keine Position.");
                      return movePosition(locked, current.point, locked.lockRevision ?? 0);
                    });
                  })();
          void mutation
            .then(() => setMessage(dropIntent?.kind === "moveUp"
              ? "Trupp wurde nach Nyx verschoben."
              : `Gespeichert: ${current.point.x.toFixed(2)} / ${current.point.y.toFixed(2)} / ${current.point.z.toFixed(2)} km`))
            .catch((reason) => {
              const confirmed = confirmedObjectPosition(objectsRef.current, current.object.id, current.object.position);
              current.mesh.position.set(confirmed.x, confirmed.y, confirmed.z);
              setMessage(reason instanceof Error ? reason.message : "Positionskonflikt – Serverstand übernommen.");
            });
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          return;
        }
        const selected = enemyPlacementRef.current;
        const completedOrbit = operation.kind === "orbit" ? operation : null;
        if (selected && completedOrbit && canWriteRef.current && Math.abs(event.clientX - completedOrbit.x) < 4 && Math.abs(event.clientY - completedOrbit.y) < 4) {
          const point = pointAt(event);
          if (point) {
            const draft = { type: "enemyMarker" as const, kind: selected, color: "#ef4444", position: point };
            void createDraft(draft).then(() => setMessage("3D-Objekt gespeichert.")).catch((reason) => setMessage(reason instanceof Error ? reason.message : "Objekt konnte nicht gesetzt werden."));
          }
        }
        operation = { kind: "idle" };
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      const cancel = (event: PointerEvent) => {
        disposePreview();
        if (operation.kind === "stroke-drag") operation.mesh.position.set(0, 0, 0);
        if (operation.kind === "position-drag") {
          const confirmed = confirmedObjectPosition(objectsRef.current, operation.object.id, operation.object.position);
          operation.mesh.position.set(confirmed.x, confirmed.y, confirmed.z);
        }
        operation = { kind: "idle" };
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      const wheel = (event: WheelEvent) => { event.preventDefault(); cameraState.distance = Math.max(8, Math.min(140, cameraState.distance * (event.deltaY > 0 ? 1.1 : 0.9))); updateCamera(); };
      canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", cancel); canvas.addEventListener("wheel", wheel, { passive: false });
      cleanupListeners.push(() => canvas.removeEventListener("pointerdown", down), () => canvas.removeEventListener("pointermove", move), () => canvas.removeEventListener("pointerup", up), () => canvas.removeEventListener("pointercancel", cancel), () => canvas.removeEventListener("wheel", wheel), disposePreview);

      resizeObserver = new ResizeObserver(() => {
        const width = Math.max(1, canvas.clientWidth); const height = Math.max(1, canvas.clientHeight);
        renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      });
      resizeObserver.observe(canvas);
      const animate = () => {
        renderer.render(scene, camera);
        for (const object of objectsRef.current) {
          if (object.type !== "groupToken") continue;
          const label = groupLabelRefs.current.get(object.groupId);
          const mesh = objectMeshes.get(object.id);
          if (!label || !mesh) continue;
          const projected = mesh.position.clone().project(camera);
          label.style.left = `${(projected.x * 0.5 + 0.5) * canvas.clientWidth}px`;
          label.style.top = `${(-projected.y * 0.5 + 0.5) * canvas.clientHeight}px`;
          label.style.display = projected.z >= -1 && projected.z <= 1 ? "block" : "none";
        }
        animationFrame = requestAnimationFrame(animate);
      };
      animate();
    }).catch(() => setMessage("WebGL konnte nicht gestartet werden."));

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      cleanupListeners.forEach((cleanup) => cleanup());
      const context = sceneContext.current;
      if (context) {
        context.scene.traverse((object) => {
          if (object instanceof context.THREE.Mesh || object instanceof context.THREE.InstancedMesh) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
        });
        context.renderer.dispose();
      }
      sceneContext.current = null;
    };
  }, [roomId, sceneId]);

  useEffect(() => {
    const context = sceneContext.current;
    if (!context) return;
    // Firestore/UI-test state is authoritative: discard every optimistic root offset.
    const { THREE, objectRoot, objectMeshes } = context;
    [...objectRoot.children].forEach(disposeRockbreakerObject3d);
    objectRoot.clear(); objectMeshes.clear();
    for (const object of objects) {
      const rendered = createRockbreakerObject3d(THREE, object);
      objectRoot.add(rendered.root); objectMeshes.set(object.id, rendered.root);
    }
  }, [objects, sceneReady]);

  return (
    <TokenDropTarget
      id={dropTargetId}
      data={{ type: "child", childId: "rockbreaker" }}
      testId={dropTestId}
      className="absolute inset-0 bg-gray-950"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-label="Rockbreaker 3D Karte" />
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
        {objects.flatMap((object) => object.type === "groupToken" ? [(
          <span
            key={object.id}
            ref={(element) => {
              if (element) groupLabelRefs.current.set(object.groupId, element);
              else groupLabelRefs.current.delete(object.groupId);
            }}
            data-testid={`rockbreaker-group-${object.groupId}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-gray-950/90 px-2 py-1 text-xs font-bold text-white shadow-xl"
            style={{ borderColor: object.color }}
          >
            {groups.find((group) => group.id === object.groupId)?.label ?? object.groupId}
          </span>
        )] : [])}
      </div>
      <div className="absolute left-3 top-3 z-10 max-w-xs rounded-xl border border-gray-600 bg-gray-950/90 p-3 text-white shadow-xl">
        <div className="flex items-center gap-2">
          <button className="rounded-lg border border-gray-600 px-2 py-1 text-xs hover:bg-gray-800" onClick={onBack}>← Nyx</button>
          <span className="text-sm font-black">Rockbreaker 3D</span>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">{message}</p>
      </div>
      {canWrite && (
        <ParentLevelDropTarget
          parentLabel="Nyx"
          testId="rockbreaker-move-up"
          className="absolute left-1/2 top-3 z-30 -translate-x-1/2 shadow-2xl"
          onNavigate={onBack}
        />
      )}
    </TokenDropTarget>
  );
}
