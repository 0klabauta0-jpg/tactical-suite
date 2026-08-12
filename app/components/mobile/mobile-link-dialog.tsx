"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";

type FetchLike = typeof fetch;

export function MobileLinkDialog({ roomId, playerName, getIdToken, onClose, fetchImpl = fetch }: {
  roomId: string;
  playerName: string;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  fetchImpl?: FetchLike;
}) {
  const [qrSource, setQrSource] = useState("");
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const issue = useCallback(async () => {
    setBusy(true);
    setError("");
    setQrSource("");
    try {
      const token = await getIdToken();
      const response = await fetchImpl(`/api/rooms/${encodeURIComponent(roomId)}/mobile-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => null) as { url?: string; expiresAtMs?: number; error?: string } | null;
      if (!response.ok || typeof body?.url !== "string" || typeof body.expiresAtMs !== "number") {
        throw new Error(body?.error ?? "QR-Code konnte nicht erstellt werden.");
      }
      const dataUrl = await QRCode.toDataURL(body.url, { errorCorrectionLevel: "M", margin: 2, width: 320 });
      setQrSource(dataUrl);
      setExpiresAtMs(body.expiresAtMs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "QR-Code konnte nicht erstellt werden.");
    } finally { setBusy(false); }
  }, [fetchImpl, getIdToken, roomId]);

  useEffect(() => { void issue(); }, [issue]);

  async function revoke() {
    setBusy(true);
    setError("");
    try {
      const token = await getIdToken();
      const response = await fetchImpl(`/api/rooms/${encodeURIComponent(roomId)}/mobile-link`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Verbindung konnte nicht widerrufen werden.");
      setQrSource("");
      setExpiresAtMs(null);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verbindung konnte nicht widerrufen werden.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="mobile-link-title">
      <div className="w-full max-w-md rounded-2xl border border-gray-600 bg-gray-900 p-6 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="mobile-link-title" className="text-xl font-black">Handy verbinden</h2>
            <p className="mt-1 text-sm text-gray-400">Persönlicher Zugang für <span className="font-bold text-white">{playerName}</span></p>
          </div>
          <button className="min-h-10 min-w-10 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800" onClick={onClose} aria-label="Dialog schließen">✕</button>
        </div>

        <div className="my-5 flex min-h-80 items-center justify-center rounded-2xl bg-white p-3">
          {qrSource ? (
            <Image unoptimized src={qrSource} alt="Persönlicher KlabsCom QR-Code" width={320} height={320} className="h-auto w-full max-w-80" />
          ) : (
            <div className="text-sm text-gray-700">{busy ? "QR-Code wird erstellt …" : "Kein aktiver QR-Code"}</div>
          )}
        </div>

        <p className="text-center text-sm text-gray-300">Scannen, Seite öffnet sich sofort, fertig.</p>
        {expiresAtMs && <p className="mt-1 text-center text-xs text-gray-500">Gültig bis {new Date(expiresAtMs).toLocaleDateString("de-DE")}</p>}
        {error && <p role="alert" className="mt-3 rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-200">{error}</p>}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button disabled={busy} className="min-h-12 rounded-xl bg-blue-700 px-3 font-bold hover:bg-blue-600 disabled:opacity-50" onClick={() => void issue()}>Verbindung erneuern</button>
          <button disabled={busy} className="min-h-12 rounded-xl border border-red-800 px-3 text-red-300 hover:bg-red-950 disabled:opacity-50" onClick={() => void revoke()}>Verbindung widerrufen</button>
        </div>
      </div>
    </div>
  );
}
