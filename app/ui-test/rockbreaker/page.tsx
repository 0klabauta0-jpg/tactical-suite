"use client";

import { notFound } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RockbreakerDrawingControls } from "@/app/components/map/rockbreaker-drawing-controls";
import { RockbreakerMap } from "@/app/components/map/rockbreaker-map";
import { DraggableTroopChip, TroopTransferProvider } from "@/app/components/map/token-transfer-controls";
import type { TokenLocation, TokenTransferIntent } from "@/lib/map/token-transfer";
import { latestOwnDrawingObject, translateStrokePoints, type RockbreakerDrawingTool } from "@/lib/rockbreaker/drawing";
import type { Vec3, WorldPoint } from "@/lib/rockbreaker/coordinates";
import type { RockbreakerStrokeWidth, SceneObject } from "@/lib/rockbreaker/scene-objects";
import type { SceneObjectDraft } from "@/lib/server/map-scene-store";

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

function seededStroke(createdBy = "other-user"): SceneObject {
  return {
    id: `stroke--seed-${createdBy}`, type: "stroke", width: 3,
    points: [
      { x: -4, y: 1, z: 0, sceneVersion: 1, anchor: { kind: "freeSpace" } },
      { x: 0, y: 4, z: 2, sceneVersion: 1, anchor: { kind: "freeSpace" } },
      { x: 4, y: 1, z: 0, sceneVersion: 1, anchor: { kind: "freeSpace" } },
    ],
    systemId: "nyx", mapId: "rockbreaker", sceneVersion: 1, color: "#22d3ee", revision: 0,
    createdBy, createdAtMs: 1, updatedBy: createdBy, updatedAtMs: 1,
  };
}

export default function RockbreakerTestPage() {
  const [objects, setObjects] = useState<SceneObject[]>([objectAt(1, 0, 1), oldEnemyAt()]);
  const [cameraA, setCameraA] = useState(0.2);
  const [, setSceneClock] = useState(0);
  const [navigationCount, setNavigationCount] = useState(0);
  const [drawingTool, setDrawingTool] = useState<RockbreakerDrawingTool>("pointer");
  const [drawingColor, setDrawingColor] = useState("#22d3ee");
  const [drawingWidth, setDrawingWidth] = useState<RockbreakerStrokeWidth>(3);
  const [previewCount, setPreviewCount] = useState(0);
  const [drawingStatus, setDrawingStatus] = useState("");
  const [enemyPlacement, setEnemyPlacement] = useState<"ground" | null>(null);
  const [viewer, setViewer] = useState(false);
  const [translationCount, setTranslationCount] = useState(0);
  const sequence = useRef(10);
  const conflictConsumed = useRef(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      const isViewer = query.get("viewer") === "1";
      setViewer(isViewer);
      setObjects([
        objectAt(1, 0, 1),
        ...(query.get("emptyEnemy") === "1" ? [] : [oldEnemyAt()]),
        ...(isViewer || query.get("foreignStroke") === "1" ? [seededStroke()] : []),
      ]);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);
  if (process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES !== "1") notFound();
  const coordinate = objects[0] && "position" in objects[0]
    ? `${objects[0].position.x.toFixed(2)} / ${objects[0].position.y.toFixed(2)} / ${objects[0].position.z.toFixed(2)}`
    : "";
  const anchor = objects[0] && "position" in objects[0] ? objects[0].position.anchor.kind : "";
  const strokePoints = JSON.stringify(objects.find((object) => object.type === "stroke")?.points.map(({ x, y, z }) => [x, y, z]) ?? []);
  const drawingPoint = objects.find((object) => object.type === "point");
  const enemy = objects.find((object) => object.type === "enemyMarker");
  const formatPosition = (position?: WorldPoint) => position
    ? `${position.x.toFixed(2)} / ${position.y.toFixed(2)} / ${position.z.toFixed(2)}`
    : "";
  const createDrawing = async (draft: SceneObjectDraft) => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("drawingCreateFailure") === "1") {
      setDrawingStatus("Zeichnung konnte nicht gespeichert werden.");
      throw new Error("Zeichnung konnte nicht gespeichert werden.");
    }
    if (draft.type !== "point" && draft.type !== "stroke" && draft.type !== "enemyMarker") throw new Error("Nicht unterstützter UI-Test-Entwurf.");
    const now = Date.now() + sequence.current++;
    const base = {
      id: `${draft.type}--ui-${now}`,
      systemId: "nyx" as const,
      mapId: "rockbreaker" as const,
      sceneVersion: 1 as const,
      color: draft.color,
      revision: 0,
      createdBy: "test",
      createdAtMs: now,
      updatedBy: "test",
      updatedAtMs: now,
    };
    const object: SceneObject = draft.type === "stroke"
      ? { ...base, type: "stroke", width: draft.width, points: draft.points }
      : draft.type === "enemyMarker"
        ? { ...base, type: "enemyMarker", kind: draft.kind, position: draft.position }
        : { ...base, type: "point", ...(draft.label ? { label: draft.label } : {}), position: draft.position };
    setObjects((current) => {
      if (draft.type !== "stroke" || new URLSearchParams(window.location.search).get("overlapDrawing") !== "1") {
        return [...current, object];
      }
      const middle = draft.points[Math.floor(draft.points.length / 2)];
      return [...current.map((candidate) => (
        (candidate.type === "groupToken" && candidate.groupId === "g1") || candidate.type === "enemyMarker"
          ? { ...candidate, position: { ...middle, anchor: { kind: "freeSpace" as const } } }
          : candidate
      )), object];
    });
    if (draft.type === "enemyMarker") setEnemyPlacement(null);
    setDrawingStatus("Zeichnung gespeichert.");
  };
  const removeDrawing = async (object: SceneObject) => {
    if (new URLSearchParams(window.location.search).get("drawingDeleteFailure") === "1") {
      setDrawingStatus("Zeichnung konnte nicht gelöscht werden.");
      throw new Error("Zeichnung konnte nicht gelöscht werden.");
    }
    if (object.type !== "point" && object.type !== "stroke") throw new Error("Nur Zeichnungen sind löschbar.");
    setObjects((current) => current.filter((candidate) => candidate.id !== object.id));
    setDrawingStatus("Zeichnung gelöscht.");
  };
  const movePosition = async (object: Extract<SceneObject, { position: WorldPoint }>, position: WorldPoint) => {
    setObjects((current) => current.map((candidate) => candidate.id === object.id && "position" in candidate
      ? { ...candidate, position, revision: candidate.revision + 1, updatedAtMs: Date.now() }
      : candidate));
  };
  const translateStroke = async (object: Extract<SceneObject, { type: "stroke" }>, translation: Vec3) => {
    if (new URLSearchParams(window.location.search).get("drawingConflict") === "1" && !conflictConsumed.current) {
      conflictConsumed.current = true;
      setDrawingStatus("Positionskonflikt – Serverstand übernommen.");
      throw new Error("Positionskonflikt – Serverstand übernommen.");
    }
    setObjects((current) => current.map((candidate) => candidate.id === object.id && candidate.type === "stroke"
      ? { ...candidate, points: translateStrokePoints(candidate.points, translation), revision: candidate.revision + 1, updatedAtMs: Date.now() }
      : candidate));
    setTranslationCount((count) => count + 1);
  };
  const shared = {
    roomId: "test",
    sceneId: "nyx--rockbreaker",
    groups: [
      { id: "g1", label: "Fight Team", systemId: "nyx" },
      { id: "g2", label: "Red Team", systemId: "nyx" },
    ],
    showGrid: true,
    canWrite: !viewer,
    getIdToken: async () => "",
    onBack: () => setNavigationCount((count) => count + 1),
    objects,
    enemyPlacement,
    onMoveGroupUp: async (groupId: string, revision: number) => {
      setObjects((current) => current.filter((object) => !(
        object.type === "groupToken" && object.groupId === groupId && object.revision === revision
      )));
    },
    onMoveGroupPosition: async (object: Extract<SceneObject, { position: unknown }>, position: Extract<SceneObject, { position: unknown }>["position"]) => {
      setObjects((current) => current.map((candidate) => candidate.id === object.id && "position" in candidate
        ? { ...candidate, position, revision: candidate.revision + 1 }
        : candidate));
    },
    currentUid: "test",
    drawingTool,
    drawingColor,
    drawingWidth,
    sceneMutations: { create: createDrawing, remove: removeDrawing, movePosition, translateStroke },
    onPreviewActiveChange: (active: boolean) => setPreviewCount(active ? 1 : 0),
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
        <button className="rounded bg-red-700 px-3 py-2" onClick={() => setEnemyPlacement("ground")}>Boden-Feindmarker setzen</button>
        <button
          data-testid="authoritative-scene-update"
          className="hidden"
          onClick={() => setObjects((current) => current.map((object) => ({ ...object, revision: object.revision + 1, updatedAtMs: Date.now() })))}
        >Authoritativen Stand aktualisieren</button>
        <DraggableTroopChip
          groupId="g2"
          label="Red Team"
          color="#dc2626"
          expectedSource={{ kind: "unplaced" }}
        />
      </div>
      {!viewer && <div className="mb-3 max-w-[280px] rounded border border-gray-700 bg-gray-900 p-2" onPointerDown={(event) => event.stopPropagation()}>
        <RockbreakerDrawingControls
          tool={drawingTool}
          color={drawingColor}
          width={drawingWidth}
          canUndo={latestOwnDrawingObject(objects, "test") !== null}
          onToolChange={setDrawingTool}
          onColorChange={setDrawingColor}
          onWidthChange={setDrawingWidth}
          onUndo={() => {
            const object = latestOwnDrawingObject(objects, "test");
            if (object) void removeDrawing(object);
          }}
        />
      </div>}
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
      <div data-testid="rockbreaker-stroke-count">{objects.filter((object) => object.type === "stroke").length}</div>
      <div data-testid="rockbreaker-point-count">{objects.filter((object) => object.type === "point").length}</div>
      <div data-testid="foreign-stroke-count">{objects.filter((object) => object.type === "stroke" && object.createdBy === "other-user").length}</div>
      <div data-testid="rockbreaker-preview-count">{previewCount}</div>
      <div data-testid="camera-a-stroke-points">{strokePoints}</div>
      <div data-testid="camera-b-stroke-points">{strokePoints}</div>
      <div data-testid="drawing-status">{drawingStatus}</div>
      <div data-testid="drawing-point-coordinate">{drawingPoint?.type === "point" ? formatPosition(drawingPoint.position) : ""}</div>
      <div data-testid="enemy-coordinate">{enemy?.type === "enemyMarker" ? formatPosition(enemy.position) : ""}</div>
      <div data-testid="overlap-ready">{objects.some((object) => object.type === "stroke") && new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("overlapDrawing") === "1" ? "1" : "0"}</div>
      <div data-testid="scene-translation-count">{translationCount}</div>
      <div>Grid sichtbar · Fight Team</div>
    </main>
  );
}
