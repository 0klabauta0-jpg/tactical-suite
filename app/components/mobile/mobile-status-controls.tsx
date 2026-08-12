"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlayerStatus, PlayerStatusAction } from "@/lib/player-status/model";

export type MobileStatusView = {
  roomName: string;
  playerName: string;
  status: PlayerStatus;
  spawns: Array<{ id: string; label: string }>;
  systemUnassigned: boolean;
};

type RequestStatus = (action?: PlayerStatusAction, expectedRevision?: number) => Promise<MobileStatusView | PlayerStatus>;

async function productionRequest(action?: PlayerStatusAction, expectedRevision?: number): Promise<MobileStatusView | PlayerStatus> {
  const response = await fetch("/api/mobile/status", action ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, expectedRevision }),
  } : { cache: "no-store" });
  const body = await response.json().catch(() => null) as (MobileStatusView & { error?: string }) | { status?: PlayerStatus; error?: string } | null;
  if (!response.ok || !body) throw new Error(body?.error ?? "Status konnte nicht geladen werden.");
  if ("roomName" in body) return body;
  if (body.status) return body.status;
  throw new Error("Status konnte nicht geladen werden.");
}

export function MobileStatusControls({ initialData, requestStatus = productionRequest, polling = true }: {
  initialData?: MobileStatusView;
  requestStatus?: RequestStatus;
  polling?: boolean;
}) {
  const [data, setData] = useState<MobileStatusView | null>(initialData ?? null);
  const [selectedSpawn, setSelectedSpawn] = useState(initialData?.status.spawnGroupId ?? initialData?.spawns[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await requestStatus();
      if ("roomName" in result) {
        setData(result);
        setSelectedSpawn((current) => current || result.status.spawnGroupId || result.spawns[0]?.id || "");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Status konnte nicht geladen werden.");
    }
  }, [requestStatus]);

  useEffect(() => { if (!initialData) void refresh(); }, [initialData, refresh]);
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);

  async function change(action: PlayerStatusAction) {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestStatus(action, data.status.revision);
      const status = "roomName" in result ? result.status : result;
      setData((current) => current ? { ...current, status } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Status konnte nicht gespeichert werden.");
    } finally { setBusy(false); }
  }

  if (!data) {
    return <main className="flex min-h-screen items-center justify-center bg-gray-950 p-6 text-gray-200">{error || "Status wird geladen …"}</main>;
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-md space-y-4">
        <header className="rounded-2xl border border-gray-700 bg-gray-900 p-5 shadow-xl">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-400">KlabsCom · Persönlich verbunden</div>
          <h1 className="mt-2 text-2xl font-black">{data.playerName}</h1>
          <p className="mt-1 text-sm text-gray-400">{data.roomName}</p>
        </header>

        <section className="rounded-2xl border border-gray-700 bg-gray-900 p-5">
          <div className={`mb-4 rounded-xl border px-4 py-4 text-center text-xl font-black ${data.status.aliveStatus === "dead" ? "border-red-700 bg-red-950 text-red-200" : "border-green-700 bg-green-950 text-green-200"}`}>
            Aktuell: {data.status.aliveStatus === "dead" ? "TOT" : "LEBT"}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button disabled={busy} className="min-h-14 rounded-xl border-2 border-green-600 bg-green-900 text-lg font-black text-green-100 disabled:opacity-50" onClick={() => void change({ type: "LIVE" })}>LEBT</button>
            <button disabled={busy} className="min-h-14 rounded-xl border-2 border-red-600 bg-red-900 text-lg font-black text-red-100 disabled:opacity-50" onClick={() => void change({ type: "TOT" })}>TOT</button>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-900 p-5">
          <label htmlFor="mobile-spawn" className="mb-2 block text-sm font-semibold text-gray-200">Spawnpunkt</label>
          {data.systemUnassigned ? (
            <p className="rounded-lg border border-yellow-800 bg-yellow-950 p-3 text-sm text-yellow-200">System noch nicht zugewiesen.</p>
          ) : (
            <>
              <select id="mobile-spawn" aria-label="Spawnpunkt" value={selectedSpawn} onChange={(event) => setSelectedSpawn(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-gray-600 bg-gray-800 px-3 text-base">
                {data.spawns.map((spawn) => <option key={spawn.id} value={spawn.id}>{spawn.label}</option>)}
              </select>
              <button disabled={busy || !selectedSpawn} className="mt-3 min-h-14 w-full rounded-xl border-2 border-blue-600 bg-blue-900 text-lg font-black text-blue-100 disabled:opacity-50"
                onClick={() => void change({ type: "RESPAWN", spawnGroupId: selectedSpawn })}>RESPAWN</button>
            </>
          )}
        </section>

        {error && <p role="alert" className="rounded-xl border border-red-800 bg-red-950 p-3 text-sm text-red-200">{error}</p>}
        <section className="min-h-24 rounded-2xl border border-dashed border-gray-700 bg-gray-900/50 p-4 text-sm text-gray-500">
          Weitere Schnellaktionen
        </section>
      </div>
    </main>
  );
}
