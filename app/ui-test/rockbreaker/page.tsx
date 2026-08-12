"use client";

import { notFound } from "next/navigation";
import { useState } from "react";
import { RockbreakerMap } from "@/app/components/map/rockbreaker-map";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";

function objectAt(x: number, y: number, z: number): SceneObject {
  return {
    id: "groupToken--g1", type: "groupToken", groupId: "g1", systemId: "nyx", mapId: "rockbreaker",
    sceneVersion: 1, color: "#3b82f6", position: { x, y, z, sceneVersion: 1, anchor: { kind: "beltPlane" } },
    revision: 1, createdBy: "test", createdAtMs: 1, updatedBy: "test", updatedAtMs: 1,
  };
}

export default function RockbreakerTestPage() {
  const [objects, setObjects] = useState<SceneObject[]>([objectAt(1, 0, 1)]);
  const [cameraA, setCameraA] = useState(0.2);
  if (process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES !== "1") notFound();
  const coordinate = objects[0] && "position" in objects[0]
    ? `${objects[0].position.x.toFixed(2)} / ${objects[0].position.y.toFixed(2)} / ${objects[0].position.z.toFixed(2)}`
    : "";
  const anchor = objects[0] && "position" in objects[0] ? objects[0].position.anchor.kind : "";
  const shared = {
    roomId: "test",
    sceneId: "nyx--rockbreaker",
    groups: [{ id: "g1", label: "Fight Team", systemId: "nyx" }],
    showGrid: true,
    canWrite: true,
    getIdToken: async () => "",
    onBack: () => undefined,
    objects,
    enemyPlacement: null,
    onMoveGroupUp: async (groupId: string, revision: number) => {
      setObjects((current) => current.filter((object) => !(
        object.type === "groupToken" && object.groupId === groupId && object.revision === revision
      )));
    },
  };
  return (
    <main className="min-h-screen bg-gray-950 p-3 text-white">
      <div className="mb-3 flex flex-wrap gap-2">
        <button className="rounded bg-blue-700 px-3 py-2" onClick={() => setObjects([objectAt(4, 2, -3)])}>Objekt auf 4 / 2 / -3 setzen</button>
        <button className="rounded bg-gray-700 px-3 py-2" onClick={() => setCameraA((value) => value + 0.5)}>Kamera A drehen</button>
      </div>
      <div className="grid h-[70vh] grid-cols-2 gap-2">
        <div className="relative" key={cameraA}><RockbreakerMap {...shared} initialCameraAzimuth={cameraA} /></div>
        <div className="relative"><RockbreakerMap {...shared} initialCameraAzimuth={1.8} /></div>
      </div>
      <div data-testid="camera-a-coordinate">{coordinate}</div>
      <div data-testid="camera-b-coordinate">{coordinate}</div>
      <div data-testid="scene-anchor">{anchor}</div>
      <div data-testid="scene-object-count">{objects.length}</div>
      <div>Grid sichtbar · Fight Team</div>
    </main>
  );
}
