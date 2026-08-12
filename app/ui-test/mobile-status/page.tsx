"use client";

import { notFound } from "next/navigation";
import { useState } from "react";
import { MobileStatusControls, type MobileStatusView } from "@/app/components/mobile/mobile-status-controls";
import type { PlayerStatusAction } from "@/lib/player-status/model";

const initial: MobileStatusView = {
  roomName: "Operation Nyx",
  playerName: "KRT Ada",
  status: {
    playerId: "p1", aliveStatus: "alive", systemId: "nyx", spawnGroupId: "spawn-1",
    revision: 1, updatedBy: "p1", updatedVia: "mobile", updatedAtMs: 1,
  },
  spawns: [{ id: "spawn-1", label: "Levski" }, { id: "spawn-2", label: "Nyx Station" }],
  systemUnassigned: false,
};

export default function MobileStatusTestPage() {
  const [data, setData] = useState(initial);
  if (process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES !== "1") notFound();
  async function requestStatus(action?: PlayerStatusAction) {
    if (!action) return data;
    const status = {
      ...data.status,
      aliveStatus: action.type === "TOT" ? "dead" as const : action.type === "LIVE" || action.type === "RESPAWN" ? "alive" as const : data.status.aliveStatus,
      ...("spawnGroupId" in action ? { spawnGroupId: action.spawnGroupId } : {}),
      revision: data.status.revision + 1,
    };
    const next = { ...data, status };
    setData(next);
    return status;
  }
  return <MobileStatusControls initialData={data} requestStatus={requestStatus} polling={false} />;
}
