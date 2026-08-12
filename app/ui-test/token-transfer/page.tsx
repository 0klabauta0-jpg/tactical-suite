"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  DraggableTroopChip,
  ParentLevelDropTarget,
  TokenDropTarget,
  TroopTransferProvider,
} from "@/app/components/map/token-transfer-controls";
import type { TokenLocation, TokenTransferIntent } from "@/lib/map/token-transfer";

const MAIN_LOCATION: TokenLocation = { kind: "map2d", mapId: "main", x: 0.32, y: 0.44 };

function nextLocation(intent: TokenTransferIntent): TokenLocation {
  if (intent.kind === "enterChild") return { kind: "map2d", mapId: intent.childId, x: 0.08, y: 0.16 };
  if (intent.kind === "moveUp") return MAIN_LOCATION;
  if (intent.kind === "place2d") return { kind: "map2d", mapId: intent.mapId, x: intent.x, y: intent.y };
  return { kind: "unplaced" };
}

function TokenTransferTestPageContent() {
  const searchParams = useSearchParams();
  const conflict = searchParams.get("conflict") === "1";
  const [location, setLocation] = useState<TokenLocation>(conflict ? MAIN_LOCATION : { kind: "unplaced" });
  const [currentMap, setCurrentMap] = useState("main");
  const [message, setMessage] = useState("");
  const [lastIntent, setLastIntent] = useState("");

  if (process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES !== "1") notFound();

  async function transfer(intent: TokenTransferIntent) {
    const confirmed = location;
    setLastIntent(JSON.stringify(intent));
    setMessage("");
    setLocation(nextLocation(intent));
    if (intent.kind === "moveUp") setCurrentMap("main");
    if (conflict) {
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      setLocation(confirmed);
      setMessage("Trupp wurde inzwischen von einem anderen Teilnehmer verschoben.");
    }
  }

  const onTransfer = ({ intent }: { intent: TokenTransferIntent }) => transfer(intent);
  const token = location.kind === "map2d" && location.mapId === currentMap ? (
    <DraggableTroopChip
      groupId="g1"
      label="Fight Team"
      color="#22d3ee"
      expectedSource={location}
      testId={`token-${currentMap}-g1`}
      className="bg-cyan-950 text-cyan-100"
    />
  ) : null;

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      <TroopTransferProvider onTransfer={onTransfer}>
        <div className="mb-8 flex items-center gap-4">
          <DraggableTroopChip
            groupId="g1"
            label="Fight Team"
            color="#22d3ee"
            expectedSource={location}
            className="bg-cyan-950 text-cyan-100"
          />
          {currentMap === "main" ? (
            <TokenDropTarget
              id="child-cap-map"
              data={{ type: "child", childId: "cap-map" }}
              testId="location-pill-cap-map"
              className="min-w-48 rounded-2xl border border-violet-500 bg-violet-950 p-4"
            >
              <button type="button" aria-label="Cap Map öffnen" onClick={() => setCurrentMap("cap-map")}>
                Cap Map
              </button>
              {location.kind === "map2d" && location.mapId === "cap-map" ? <span className="ml-3">Fight Team</span> : null}
            </TokenDropTarget>
          ) : (
            <ParentLevelDropTarget />
          )}
        </div>

        <TokenDropTarget
          id={`map-${currentMap}`}
          data={{ type: "map2d", mapId: currentMap }}
          className="relative h-96 rounded-2xl border border-gray-700 bg-gray-900 p-8"
        >
          <div className="absolute left-1/3 top-1/3">{token}</div>
        </TokenDropTarget>
      </TroopTransferProvider>
      <div role="status" data-testid="transfer-status" className="mt-4 text-amber-300">{message}</div>
      <output data-testid="last-transfer-intent" className="sr-only">{lastIntent}</output>
    </main>
  );
}

export default function TokenTransferTestPage() {
  return (
    <Suspense fallback={null}>
      <TokenTransferTestPageContent />
    </Suspense>
  );
}
