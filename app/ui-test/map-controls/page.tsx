"use client";

import { notFound } from "next/navigation";
import { useState } from "react";
import { MapControlDock } from "@/app/components/map/map-control-dock";
import { DEFAULT_MAP_UI_PREFERENCES, type MapUiPreferences } from "@/lib/map/ui-preferences";

export default function MapControlsTestPage() {
  const [preferences, setPreferences] = useState<MapUiPreferences>(DEFAULT_MAP_UI_PREFERENCES);

  if (process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES !== "1") notFound();

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <MapControlDock
        preferences={preferences}
        onPreferencesChange={setPreferences}
        maps={<div>Karten-Testinhalt</div>}
        tokens={<div>Token-Testinhalt</div>}
        drawing={<div>Zeichen-Testinhalt</div>}
      />
    </main>
  );
}
