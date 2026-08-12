"use client";

import { notFound } from "next/navigation";
import { useState } from "react";
import { RockbreakerMap } from "@/app/components/map/rockbreaker-map";
import { DraggableTroopChip, TroopTransferProvider } from "@/app/components/map/token-transfer-controls";
import type { TokenLocation, TokenTransferIntent } from "@/lib/map/token-transfer";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";

function objectAt(x: number, y: number, z: number, groupId = "g1", color = "#3b82f6"): SceneObject {
  return {
    id: `groupToken--${groupId}`, type: "groupToken", groupId, systemId: "nyx", mapId: "rockbreaker",
    sceneVersion: 1, color, position: { x, y, z, sceneVersion: 1, anchor: { kind: "beltPlane" } },
    revision: 1, createdBy: "test", createdAtMs: 1, updatedBy: "test", updatedAtMs: 1,
  };
}

function oldEnemyAt(): SceneObject {
  return {
    id: "enemy--old",
    type: "enemyMarker",
    kind: "ground",
    systemId: "nyx",
    mapId: "rockbreaker",
    sceneVersion: 1,
    color: "#ef4444",
    position: { x: -2, y: 0, z: 3, sceneVersion: 1, anchor: { kind: "beltPlane" } },
    revision: 1,
    createdBy: "test",
    createdAtMs: 1,
    updatedBy: "test",
    updatedAtMs: 1,
  };
}

export default function RockbreakerTestPage() {
  const [objects, setObjects] = useState<SceneObject[]>([objectAt(1, 0, 1), oldEnemyAt()]);
  const [cameraA, setCameraA] = useState(0.2);
  const [, setSceneClock] = useState(0);
  const [navigationCount, setNavigationCount] = useState(0);
  if (process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES !== "1") notFound();
  const coordinate = objects[0] && "position" in objects[0]
    ? `${objects[0].position.x.toFixed(2)} / ${objects[0].position.y.toFixed(2)} / ${objects[0].position.z.toFixed(2)}`
    : "";
  const anchor = objects[0] && "position" in objects[0] ? objects[0].position.anchor.kind : "";
  const shared = {
    roomId: "test",
    sceneId: "nyx--rockbreaker",
    groups: [
      { id: "g1", label: "Fight Team", systemId: "nyx" },
      { id: "g2", label: "Red Team", systemId: "nyx" },
    ],
    showGrid: true,
    canWrite: true,
    getIdToken: async () => "",
    onBack: () => setNavigationCount((count) => count + 1),
    objects,
    enemyPlacement: null,
    onMoveGroupUp: async (groupId: string, revision: number) => {
      setObjects((current) => current.filter((object) => !(
        object.type === "groupToken" && object.groupId === groupId && object.revision === revision
      )));
    },
  };
  async function handleTransfer({ groupId, intent }: { groupId: string; expectedSource: TokenLocation; intent: TokenTransferIntent }) {
    if (intent.kind !== "enterChild" || intent.childId !== "rockbreaker") return;
    setObjects((current) => current.some((object) => object.type === "groupToken" && object.groupId === groupId)
      ? current
      : [...current, objectAt(6, 0, 2, groupId, "#dc2626")]);
  }
  return (
    <main className="min-h-screen bg-gray-950 p-3 text-white">
      <TroopTransferProvider onTransfer={handleTransfer}>
      <div className="mb-3 flex flex-wrap gap-2">
        <button className="rounded bg-blue-700 px-3 py-2" onClick={() => setObjects((current) => [objectAt(4, 2, -3), ...current.filter((object) => object.type === "enemyMarker")])}>Objekt auf 4 / 2 / -3 setzen</button>
        <button className="rounded bg-gray-700 px-3 py-2" onClick={() => setCameraA((value) => value + 0.5)}>Kamera A drehen</button>
        <button className="rounded bg-gray-700 px-3 py-2" onClick={() => setSceneClock((value) => value + 365 * 24 * 60 * 60 * 1000)}>3D-Zeit ein Jahr vorspulen</button>
        <button className="rounded bg-red-800 px-3 py-2" onClick={() => setObjects((current) => current.filter((object) => object.type !== "enemyMarker"))}>3D-Feindmarker löschen</button>
        <DraggableTroopChip
          groupId="g2"
          label="Red Team"
          color="#dc2626"
          expectedSource={{ kind: "unplaced" }}
        />
      </div>
      <div className="grid h-[70vh] grid-cols-2 gap-2">
        <div className="relative" key={cameraA}><RockbreakerMap {...shared} initialCameraAzimuth={cameraA} dropTargetId="rockbreaker-scene-a" dropTestId="rockbreaker-scene-drop-a" /></div>
        <div className="relative"><RockbreakerMap {...shared} initialCameraAzimuth={1.8} dropTargetId="rockbreaker-scene-b" dropTestId="rockbreaker-scene-drop-b" /></div>
      </div>
      </TroopTransferProvider>
      <div data-testid="camera-a-coordinate">{coordinate}</div>
      <div data-testid="camera-b-coordinate">{coordinate}</div>
      <div data-testid="scene-anchor">{anchor}</div>
      <div data-testid="scene-object-count">{objects.length}</div>
      <div data-testid="rockbreaker-enemy-count">{objects.filter((object) => object.type === "enemyMarker").length}</div>
      <div data-testid="rockbreaker-navigation-count">{navigationCount}</div>
      <div>Grid sichtbar · Fight Team</div>
    </main>
  );
}
