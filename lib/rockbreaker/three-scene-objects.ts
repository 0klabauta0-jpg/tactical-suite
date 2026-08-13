import type * as Three from "three";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";

export type RockbreakerRenderedObject = {
  root: Three.Object3D;
  hitTarget: Three.Object3D;
};

const strokeRadius = (width: 1 | 3 | 6) => ({ 1: 0.04, 3: 0.08, 6: 0.14 })[width];

function createPath(
  THREE: typeof import("three"),
  objectId: string,
  color: string,
  points: readonly { x: number; y: number; z: number }[],
  radius: number,
): RockbreakerRenderedObject {
  const root = new THREE.Group();
  root.userData.objectId = objectId;
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(point.x, point.y, point.z)));
  const segments = Math.max(8, (points.length - 1) * 8);
  const visible = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments, radius, 8, false),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 }),
  );
  const hitTarget = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments, Math.max(0.22, radius), 8, false),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  visible.userData.objectId = objectId;
  hitTarget.userData.objectId = objectId;
  root.add(visible, hitTarget);
  return { root, hitTarget };
}

export function createRockbreakerObject3d(
  THREE: typeof import("three"),
  object: SceneObject,
): RockbreakerRenderedObject {
  if (object.type === "stroke") {
    return createPath(THREE, object.id, object.color, object.points, strokeRadius(object.width));
  }
  if (object.type === "line") {
    return createPath(THREE, object.id, object.color, [object.start, object.end], 0.04);
  }

  const geometry = object.type === "enemyMarker"
    ? new THREE.ConeGeometry(0.45, 1.2, 4)
    : object.type === "point"
      ? new THREE.SphereGeometry(0.24, 16, 12)
      : new THREE.SphereGeometry(0.55, 16, 12);
  const material = new THREE.MeshStandardMaterial({
    color: object.color,
    emissive: object.color,
    emissiveIntensity: object.type === "point" ? 0.8 : 0.25,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(object.position.x, object.position.y, object.position.z);
  mesh.userData.objectId = object.id;
  return { root: mesh, hitTarget: mesh };
}

export function disposeRockbreakerObject3d(root: Three.Object3D): void {
  root.traverse((object) => {
    const renderable = object as Three.Object3D & {
      geometry?: Three.BufferGeometry;
      material?: Three.Material | Three.Material[];
    };
    renderable.geometry?.dispose();
    const materials = renderable.material
      ? Array.isArray(renderable.material) ? renderable.material : [renderable.material]
      : [];
    materials.forEach((material) => material.dispose());
  });
}
