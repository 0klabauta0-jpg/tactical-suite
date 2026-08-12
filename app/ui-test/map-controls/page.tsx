"use client";

import { notFound } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MapControlDock } from "@/app/components/map/map-control-dock";
import { enemyMarkerAgeLabel, normalizeEnemyMarker } from "@/lib/map/enemy-markers";
import { DEFAULT_MAP_UI_PREFERENCES, loadMapUiPreferences, saveMapUiPreferences, type MapUiPreferences } from "@/lib/map/ui-preferences";

export default function MapControlsTestPage() {
  const [preferences, setPreferences] = useState<MapUiPreferences>(DEFAULT_MAP_UI_PREFERENCES);
  const [preferenceKey, setPreferenceKey] = useState("room-a:player-a");
  const [enemyVisible, setEnemyVisible] = useState(true);
  const [markerNow, setMarkerNow] = useState(365 * 24 * 60 * 60 * 1000);
  const loadedKey = useRef<string | null>(null);
  const skipNextSave = useRef(true);

  useEffect(() => {
    skipNextSave.current = true;
    // This gated harness intentionally models the production post-hydration preference load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferences(loadMapUiPreferences(window.localStorage, preferenceKey));
    loadedKey.current = preferenceKey;
  }, [preferenceKey]);

  useEffect(() => {
    if (loadedKey.current !== preferenceKey) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    saveMapUiPreferences(window.localStorage, preferenceKey, preferences);
  }, [preferenceKey, preferences]);

  if (process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES !== "1") notFound();

  const oldEnemy = normalizeEnemyMarker({
    id: "old-enemy",
    type: "marker",
    kind: "ground",
    x: 0.3,
    y: 0.4,
    opacity: 0.01,
    createdAt: 0,
  });

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="p-3">
        <button type="button" onClick={() => setPreferenceKey("room-b:player-b")}>Anderen Raum/Spieler verwenden</button>
        <button type="button" className="ml-3" onClick={() => setMarkerNow((value) => value + 365 * 24 * 60 * 60 * 1000)}>Ein Jahr vorspulen</button>
        {enemyVisible && oldEnemy && (
          <span data-testid="old-enemy-marker" className="ml-3" style={{ opacity: oldEnemy.opacity }}>
            Feind {enemyMarkerAgeLabel(oldEnemy.createdAt, markerNow)}
          </span>
        )}
        <button type="button" className="ml-3" onClick={() => setEnemyVisible(false)}>Feindmarker löschen</button>
      </div>
      <MapControlDock
        preferences={preferences}
        onPreferencesChange={setPreferences}
        maps={<div>Karten-Testinhalt</div>}
        tokens={<div>Token-Testinhalt</div>}
        enemy={<div>Feindmarker-Testinhalt</div>}
        drawing={<div>Zeichen-Testinhalt</div>}
      />
    </main>
  );
}
