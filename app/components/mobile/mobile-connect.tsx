"use client";

import { useEffect, useRef, useState } from "react";

function connectionData(fragment: string) {
  const params = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment);
  const roomId = params.get("r") ?? "";
  const playerId = params.get("p") ?? "";
  const token = params.get("t") ?? "";
  if (!roomId || roomId.length > 128 || !playerId || playerId.length > 256 || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return { roomId, playerId, token };
}

export function MobileConnect() {
  const started = useRef(false);
  const [message, setMessage] = useState("Persönliche Verbindung wird hergestellt …");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const data = connectionData(window.location.hash);
    window.history.replaceState(null, "", "/connect");
    if (!data) {
      queueMicrotask(() => setMessage("Verbindung ungültig oder widerrufen."));
      return;
    }
    fetch("/api/mobile/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(data),
    }).then(async (response) => {
      const body = await response.json().catch(() => null) as { redirectTo?: string } | null;
      if (!response.ok || body?.redirectTo !== "/mobile/status") throw new Error("invalid");
      window.location.replace(body.redirectTo);
    }).catch(() => setMessage("Verbindung ungültig oder widerrufen."));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 px-5 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-7 text-center shadow-xl">
        <h1 className="mb-3 text-xl font-bold">KlabsCom</h1>
        <p className="text-sm text-gray-300" role="status">{message}</p>
      </div>
    </main>
  );
}
