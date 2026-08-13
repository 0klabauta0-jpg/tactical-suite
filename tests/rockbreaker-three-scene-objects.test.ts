import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { WorldPoint } from "@/lib/rockbreaker/coordinates";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";
import {
  createRockbreakerObject3d,
  disposeRockbreakerObject3d,
} from "@/lib/rockbreaker/three-scene-objects";

const free = (x: number, y = 0, z = 0): WorldPoint => ({
  x, y, z, sceneVersion: 1, anchor: { kind: "freeSpace" },
});

const base = {
  systemId: "nyx" as const,
  mapId: "rockbreaker" as const,
  sceneVersion: 1 as const,
  revision: 0,
  createdBy: "u1",
  createdAtMs: 1,
  updatedBy: "u1",
  updatedAtMs: 1,
};

describe("Rockbreaker Three.js scene objects", () => {
  it("builds a world-space stroke with an enlarged hit target", () => {
    const stroke: SceneObject = {
      ...base,
      id: "s1",
      type: "stroke",
      width: 3,
      points: [free(0), free(1, 1)],
      color: "#22d3ee",
    };

    const rendered = createRockbreakerObject3d(THREE, stroke);

    expect(rendered.root.userData.objectId).toBe("s1");
    expect(rendered.hitTarget.userData.objectId).toBe("s1");
    expect(rendered.root.children).toHaveLength(2);
    const visible = rendered.root.children[0] as THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>;
    const hitTarget = rendered.hitTarget as THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
    expect(visible.geometry.parameters.radius).toBe(0.08);
    expect(hitTarget.geometry.parameters.radius).toBeGreaterThanOrEqual(0.22);
    expect(hitTarget.material.opacity).toBe(0);
    expect(hitTarget.material.depthWrite).toBe(false);

    const geometryDispose = vi.spyOn(visible.geometry, "dispose");
    const materialDispose = vi.spyOn(visible.material, "dispose");
    const hitGeometryDispose = vi.spyOn(hitTarget.geometry, "dispose");
    const hitMaterialDispose = vi.spyOn(hitTarget.material, "dispose");
    disposeRockbreakerObject3d(rendered.root);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(hitGeometryDispose).toHaveBeenCalledOnce();
    expect(hitMaterialDispose).toHaveBeenCalledOnce();
  });

  it("renders points and legacy lines at their stored world coordinates", () => {
    const point: SceneObject = {
      ...base,
      id: "p1",
      type: "point",
      color: "#f97316",
      position: free(2, 3, 4),
    };
    const line: SceneObject = {
      ...base,
      id: "l1",
      type: "line",
      color: "#ffffff",
      start: free(-1, 2, 3),
      end: free(4, 5, 6),
    };

    const renderedPoint = createRockbreakerObject3d(THREE, point);
    const renderedLine = createRockbreakerObject3d(THREE, line);

    expect(renderedPoint.root.position.toArray()).toEqual([2, 3, 4]);
    expect((renderedPoint.hitTarget as THREE.Mesh).material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(renderedLine.root.children).toHaveLength(2);
    const lineGeometry = (renderedLine.root.children[0] as THREE.Mesh<THREE.TubeGeometry>).geometry;
    expect(lineGeometry.parameters.path.getPoint(0).toArray()).toEqual([-1, 2, 3]);
    expect(lineGeometry.parameters.path.getPoint(1).toArray()).toEqual([4, 5, 6]);

    disposeRockbreakerObject3d(renderedPoint.root);
    disposeRockbreakerObject3d(renderedLine.root);
  });
});
