"use client";

import { useEffect, useRef, useState } from "react";
import type * as Three from "three";
import { ParentLevelDropTarget, tokenDropIntentAtPoint } from "@/app/components/map/token-transfer-controls";
import type { BoardGroup } from "@/lib/board/state";
import { createMapSceneObject, lockMapSceneObject, moveMapSceneObject } from "@/lib/map-scene/client";
import { loadRockbreakerField } from "@/lib/rockbreaker/field";
import { resolveWorldPoint, worldPointFromHit, type AsteroidHit, type Mat4, type WorldPoint } from "@/lib/rockbreaker/coordinates";
import { confirmedObjectPosition, type SceneObject } from "@/lib/rockbreaker/scene-objects";

export type RockbreakerEnemyKind = "infantry" | "ground" | "air";
type PositionedSceneObject = Extract<SceneObject, { position: WorldPoint }>;

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
  initialCameraAzimuth = 0.7,
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
  initialCameraAzimuth?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectsRef = useRef<SceneObject[]>(objects);
  const enemyPlacementRef = useRef<RockbreakerEnemyKind | null>(enemyPlacement);
  const onMoveGroupUpRef = useRef(onMoveGroupUp);
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
      const setRay = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
      };
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

      const orbit = { active: false, x: 0, y: 0, azimuth: 0, elevation: 0 };
      let drag: { object: PositionedSceneObject; mesh: Three.Object3D; lockRevision?: number; point: WorldPoint } | null = null;
      const down = (event: PointerEvent) => {
        setRay(event);
        const objectHit = raycaster.intersectObjects([...objectMeshes.values()], true).find((hit) => hit.object.userData.objectId || hit.object.parent?.userData.objectId);
        const objectId = objectHit ? String(objectHit.object.userData.objectId ?? objectHit.object.parent?.userData.objectId) : "";
        const object = objectsRef.current.find((candidate) => candidate.id === objectId);
        if (object && canWriteRef.current && "position" in object) {
          event.preventDefault();
          canvas.setPointerCapture(event.pointerId);
          if (object.type === "groupToken") {
            const mesh = objectMeshes.get(object.id);
            if (mesh) drag = { object, mesh, point: object.position };
            return;
          }
          void lockMapSceneObject(roomId, sceneId, object.id, () => getIdTokenRef.current()).then((locked) => {
            const mesh = objectMeshes.get(object.id);
            if (mesh && "position" in locked) drag = { object: locked, mesh, lockRevision: locked.lockRevision ?? 0, point: locked.position };
          }).catch((reason) => setMessage(reason instanceof Error ? reason.message : "Objekt ist gesperrt."));
          return;
        }
        orbit.active = true; orbit.x = event.clientX; orbit.y = event.clientY; orbit.azimuth = cameraState.azimuth; orbit.elevation = cameraState.elevation;
        canvas.setPointerCapture(event.pointerId);
      };
      const move = (event: PointerEvent) => {
        if (drag) {
          const point = pointAt(event);
          if (point) { drag.point = point; drag.mesh.position.set(point.x, point.y, point.z); }
          return;
        }
        if (orbit.active) {
          cameraState.azimuth = orbit.azimuth - (event.clientX - orbit.x) * 0.008;
          cameraState.elevation = Math.max(-1.25, Math.min(1.25, orbit.elevation + (event.clientY - orbit.y) * 0.006));
          updateCamera();
        }
      };
      const up = (event: PointerEvent) => {
        if (drag) {
          const current = drag; drag = null;
          const dropIntent = tokenDropIntentAtPoint(event.clientX, event.clientY);
          const operation = current.object.type === "groupToken" && dropIntent?.kind === "moveUp"
            ? onMoveGroupUpRef.current(current.object.groupId, current.object.revision)
            : current.object.type === "groupToken"
              ? lockMapSceneObject(roomId, sceneId, current.object.id, () => getIdTokenRef.current()).then((locked) => {
                  if (!("position" in locked)) throw new Error("Truppenmarker besitzt keine Position.");
                  return moveMapSceneObject(roomId, sceneId, locked, current.point, locked.lockRevision ?? 0, () => getIdTokenRef.current());
                })
              : moveMapSceneObject(roomId, sceneId, current.object, current.point, current.lockRevision ?? 0, () => getIdTokenRef.current());
          void operation
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
        if (selected && canWriteRef.current && Math.abs(event.clientX - orbit.x) < 4 && Math.abs(event.clientY - orbit.y) < 4) {
          const point = pointAt(event);
          if (point) {
            const draft = { type: "enemyMarker" as const, kind: selected, color: "#ef4444", position: point };
            void createMapSceneObject(roomId, sceneId, draft, () => getIdTokenRef.current()).then(() => setMessage("3D-Objekt gespeichert.")).catch((reason) => setMessage(reason instanceof Error ? reason.message : "Objekt konnte nicht gesetzt werden."));
          }
        }
        orbit.active = false;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      const wheel = (event: WheelEvent) => { event.preventDefault(); cameraState.distance = Math.max(8, Math.min(140, cameraState.distance * (event.deltaY > 0 ? 1.1 : 0.9))); updateCamera(); };
      canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("wheel", wheel, { passive: false });
      cleanupListeners.push(() => canvas.removeEventListener("pointerdown", down), () => canvas.removeEventListener("pointermove", move), () => canvas.removeEventListener("pointerup", up), () => canvas.removeEventListener("wheel", wheel));

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
    const { THREE, objectRoot, objectMeshes } = context;
    objectRoot.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      }
    });
    objectRoot.clear(); objectMeshes.clear();
    for (const object of objects) {
      if (!("position" in object)) continue;
      const geometry = object.type === "enemyMarker" ? new THREE.ConeGeometry(0.45, 1.2, 4) : new THREE.SphereGeometry(0.55, 16, 12);
      const material = new THREE.MeshStandardMaterial({ color: object.color, emissive: object.color, emissiveIntensity: 0.25 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(object.position.x, object.position.y, object.position.z);
      mesh.userData.objectId = object.id;
      objectRoot.add(mesh); objectMeshes.set(object.id, mesh);
    }
  }, [objects, sceneReady]);

  return (
    <div className="absolute inset-0 bg-gray-950">
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
        />
      )}
    </div>
  );
}
