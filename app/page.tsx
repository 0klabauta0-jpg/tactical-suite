"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { DndContext, DragEndEvent, PointerSensor, type DraggableAttributes, type DraggableSyntheticListeners, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSearchParams } from "next/navigation";
import { db, auth } from "@/lib/firebase";
import { canAdministerRoom, canWriteBoard, parseRole, type Role } from "@/lib/domain/roles";
import type { EditablePlayerField, Player, PlayerOverrides } from "@/lib/domain/player";
import { mergeWithOverrides } from "@/lib/players/merge-overrides";
import { parsePlayerOverrides } from "@/lib/players/overrides";
import { loadPlayersFromSheet, type PlayerLoadResult } from "@/lib/players/sheet-loader";
import { parseRoomConfig, type RoomConfig } from "@/lib/rooms/config";
import { buildRoomTemplateCopy } from "@/lib/rooms/template";
import { getErrorMessage } from "@/lib/error-details";
import { loginToRoom } from "@/lib/auth/room-login-client";
import { changePlayerStatusClient } from "@/lib/player-status/client";
import { parsePlayerStatus, type PlayerStatus, type PlayerStatusAction } from "@/lib/player-status/model";
import { MapControlDock } from "@/app/components/map/map-control-dock";
import { enemyMarkerAgeLabel, normalizeEnemyMarker, type EnemyMarker } from "@/lib/map/enemy-markers";
import {
  DEFAULT_MAP_UI_PREFERENCES,
  loadMapUiPreferences,
  saveMapUiPreferences,
  type MapUiPreferences,
} from "@/lib/map/ui-preferences";
import { zoomIn, zoomOut } from "@/lib/map/zoom";
import { parseBoardState, type BoardGroup as Group, type BoardState } from "@/lib/board/state";
import {
  parseMapEntries,
  parseOrderMarkers,
  parsePois,
  parseTokens,
  type BoardMapEntry as MapEntry,
  type BoardOrderMarker as OrderMarker,
  type BoardPoi as POI,
  type BoardToken as Token,
} from "@/lib/board/collections";
import {
  parseAliveState,
  parseGroupRoles,
  parseSpawnState,
  type BoardGroupRoles as GroupRoles,
  type BoardPlayerAliveState as PlayerAliveState,
  type BoardPlayerSpawnState as PlayerSpawnState,
} from "@/lib/board/members";
import { doc, getDoc, getDocs, collection, onSnapshot, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  signInWithCustomToken,
  onAuthStateChanged,
  signOut,
  User,
} from "firebase/auth";

// ─────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────
const APP_VERSION = "1.010";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

// GroupRoles: leader/deputy pro Gruppe


// ── Star Citizen Systeme ──────────────────────────────────────────────────
type StarSystem = { id: string; label: string; x: number; y: number }; // Position auf Galaxie-Karte
type PanelLayout = {
  nav:      { x: number; y: number };
  placer:   { x: number; y: number };
  notes:    { x: number; y: number; w: number; h: number };
  logNotes: { x: number; y: number; w: number; h: number; visible: boolean };
  opLog:    { x: number; y: number; w: number; h: number; visible: boolean };
  toolbar:  { x: number; y: number };
  zoom:     { x: number; y: number };
};

type LogEntry = { ts: number; text: string };
type OpLogEntry = {
  ts: number;          // Date.now()
  actor: string;       // Spielername
  type: string;        // "alive" | "group_change" | "token_set" | "token_move" | "token_remove" | "group_add" | "group_rename" | "group_delete" | "group_system"
  text: string;        // Human-readable
  systemId?: string;   // zugeordnetes System für System-Filter
};
type ScheduledOpLogEntry = OpLogEntry & {
  newX?: number;
  newY?: number;
  _groupLabel?: string;
  _mapLabel?: string;
};
type PendingOpLogEntry = {
  timer: ReturnType<typeof setTimeout>;
  entry: ScheduledOpLogEntry;
  prevX?: number;
  prevY?: number;
  startX?: number;
  startY?: number;
  minDist?: number;
};

// RoomConfig wird aus Firestore geladen (rooms/{roomId}/config)
// NEXT_PUBLIC_SHEET_CSV_URL und NEXT_PUBLIC_TEAM_PASSWORD sind nicht mehr nötig.
const roomConfigCache: Record<string, RoomConfig> = {};

async function loadRoomConfig(roomId: string): Promise<RoomConfig | null> {
  if (roomConfigCache[roomId]) return roomConfigCache[roomId];
  try {
    const snap = await getDoc(doc(db, "rooms", roomId, "config", "main"));
    if (!snap.exists()) {
      console.warn("[KlabsCom] loadRoomConfig: Dokument nicht gefunden:", `rooms/${roomId}/config/main`);
      return null;
    }
    const cfg = parseRoomConfig(snap.data());
    if (!cfg) {
      console.warn("[KlabsCom] loadRoomConfig: sheetUrl fehlt");
      return null;
    }
    roomConfigCache[roomId] = cfg;
    return cfg;
  } catch (e) {
    console.error("[KlabsCom] loadRoomConfig Fehler:", e);
    return null;
  }
}

function invalidateRoomConfig(roomId: string) {
  delete roomConfigCache[roomId];
}

const DEFAULT_GROUPS: Group[] = [
  { id: "unassigned", label: "Unzugeteilt" },
  { id: "g1", label: "Marines", systemId: "pyro" },
  { id: "g2", label: "Air", systemId: "pyro" },
  { id: "g3", label: "Subradar", systemId: "pyro" },
  { id: "spawn1", label: "Spawn", isSpawn: true, systemId: "pyro" },
];

const DEFAULT_SYSTEMS: StarSystem[] = [
  { id: "stanton", label: "Stanton", x: 0.35, y: 0.45 },
  { id: "pyro",    label: "Pyro",    x: 0.60, y: 0.40 },
  { id: "nyx",     label: "Nyx",     x: 0.50, y: 0.65 },
];

function getDefaultMaps(systemId: string): MapEntry[] {
  switch ((systemId || "").toLowerCase()) {
    case "stanton":
      return [{ id: "main", label: "Stanton System", image: "/stanton-map.png" }];
    case "nyx":
      return [{ id: "main", label: "Nyx System", image: "/nyx-map.png" }];
    case "pyro":
    default:
      return [{ id: "main", label: "Pyro System", image: "/pyro-map.png" }];
  }
}

function normalizeMapsForSystem(systemId: string, maps: MapEntry[]): MapEntry[] {
  const normalizedSystemId = (systemId || "pyro").toLowerCase();
  const source = Array.isArray(maps) && maps.length > 0 ? maps : getDefaultMaps(normalizedSystemId);
  const main = getDefaultMaps(normalizedSystemId)[0];

  if (source.some((m: MapEntry) => m.id === "main")) {
    return source.map((m: MapEntry) => (m.id === "main" ? { ...m, label: main.label, image: main.image } : m));
  }

  return [main, ...source];
}

// Galaxie-Systemwechsel erfolgt über das Dropdown auf der Gruppenkarte

const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  nav:      { x: 16,  y: 16  },
  placer:   { x: 16,  y: 340 },
  notes:    { x: 20,  y: 70, w: 320, h: 220 },
  logNotes: { x: 360, y: 70, w: 320, h: 220, visible: false },
  opLog:    { x: 700, y: 70, w: 380, h: 280, visible: false },
  toolbar:  { x: 300, y: 16  },
  zoom:     { x: 16,  y: 600 },
};

const PANEL_MIN_Y   = 70;
const NOTES_MIN_W   = 180;
const NOTES_MIN_H   = 120;
const LOG_MIN_W     = 180;
const LOG_MIN_H     = 80;
const OPLOG_MIN_W   = 280;
const OPLOG_MIN_H   = 120;

function clampPanelPosition(x: number, y: number, w: number, h: number) {
  if (typeof window === "undefined") return { x: Math.max(0, x), y: Math.max(PANEL_MIN_Y, y) };
  return {
    x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth  - w)),
    y: Math.min(Math.max(PANEL_MIN_Y, y), Math.max(PANEL_MIN_Y, window.innerHeight - h)),
  };
}

function clampPanelSize(w: number, h: number, minW: number, minH: number, x: number, y: number) {
  if (typeof window === "undefined") return { w: Math.max(minW, w), h: Math.max(minH, h) };
  return {
    w: Math.min(Math.max(minW, w), Math.max(minW, window.innerWidth  - Math.max(0, x))),
    h: Math.min(Math.max(minH, h), Math.max(minH, window.innerHeight - Math.max(PANEL_MIN_Y, y))),
  };
}

function clampNotes(p: { x?: number; y?: number; w?: number; h?: number; visible?: boolean }, def: { x: number; y: number; w: number; h: number }, minW: number, minH: number) {
  const w = p.w ?? def.w; const h = p.h ?? def.h;
  const pos  = clampPanelPosition(p.x ?? def.x, p.y ?? def.y, w, h);
  const size = clampPanelSize(w, h, minW, minH, pos.x, pos.y);
  return { ...p, ...pos, ...size };
}

// ─── DRAWING TYPES ───────────────────────────────────────────
type DrawTool = "pointer" | "pen" | "line" | "eraser" | "text" | "move" | "marker_infantry" | "marker_ground" | "marker_air";

type DrawStroke = {
  id: string; type: "path";
  d: string; color: string; width: number;
};
type DrawLine = {
  id: string; type: "line";
  x1: number; y1: number; x2: number; y2: number;
  color: string; width: number;
};
type DrawText = {
  id: string; type: "text";
  x: number; y: number;
  text: string; color: string; size: number;
};
type DrawMarker = EnemyMarker;
type DrawElement = DrawStroke | DrawText | DrawLine | DrawMarker;
type DrawingsMap = Record<string, DrawElement[]>;

const DRAW_COLORS = ["#ffffff","#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7","#000000"];
const DRAW_WIDTHS = [2, 4, 8, 16];

// ─────────────────────────────────────────────────────────────
// Preset-Farben für Gruppen
const GROUP_COLORS = [
  { label: "Blau",    hex: "3b82f6" },
  { label: "Grün",    hex: "22c55e" },
  { label: "Rot",     hex: "ef4444" },
  { label: "Orange",  hex: "f97316" },
  { label: "Lila",    hex: "a855f7" },
  { label: "Cyan",    hex: "06b6d4" },
  { label: "Gelb",    hex: "eab308" },
  { label: "Pink",    hex: "ec4899" },
  { label: "Grau",    hex: "6b7280" },
];

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function ampelColor(a?: string) {
  if (a === "gut") return "#16a34a";
  if (a === "mittel") return "#ca8a04";
  return "#dc2626";
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function currentTimestamp(): number {
  return Date.now();
}

function applyMapTransform(element: HTMLDivElement, x: number, y: number, scale: number) {
  element.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
}

function normalizeImageUrl(url: string): string {
  if (!url) return url;
  const driveFile = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveFile) return `https://drive.google.com/uc?export=view&id=${driveFile[1]}`;
  const driveOpen = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (driveOpen) return `https://drive.google.com/uc?export=view&id=${driveOpen[1]}`;
  if (url.includes("docs.google.com")) return "";
  return url;
}

// Gruppenfarbe als CSS-Wert (mit #)
function groupColor(g: Group): string {
  return g.color ? `#${g.color}` : "#3b82f6";
}

// ─────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────

// Pro-Room Player-Cache (roomId → Player[])
const cachedPlayersByRoom: Record<string, Player[]> = {};

// Firestore-Override-Cache: roomId → { playerId → Partial<Player> }
// Wird bei Login geladen. Enthält nur Felder die Firestore überschreibt (z.B. appRole).
const firestoreOverrideCache: Record<string, PlayerOverrides> = {};

async function loadFirestoreOverrides(roomId: string): Promise<PlayerOverrides> {
  if (firestoreOverrideCache[roomId]) return firestoreOverrideCache[roomId];
  try {
    const snap = await getDoc(doc(db, "rooms", roomId, "config", "playerOverrides"));
    if (!snap.exists()) { firestoreOverrideCache[roomId] = {}; return {}; }
    const data = parsePlayerOverrides(snap.data());
    firestoreOverrideCache[roomId] = data;
    return data;
  } catch { return {}; }
}

async function saveFirestoreOverride(roomId: string, playerId: string, fields: Partial<Omit<Player, "id">>) {
  const overrides = await loadFirestoreOverrides(roomId);
  const next: PlayerOverrides = { ...overrides, [playerId]: { ...(overrides[playerId] ?? {}), ...fields } };
  firestoreOverrideCache[roomId] = next;
  await setDoc(doc(db, "rooms", roomId, "config", "playerOverrides"), next, { merge: true });
}

async function loadPlayersForRoom(roomId: string, force = false): Promise<PlayerLoadResult> {
  if (!force && cachedPlayersByRoom[roomId]?.length) {
    return { players: cachedPlayersByRoom[roomId], source: "cache" };
  }
  const cfg = await loadRoomConfig(roomId);
  const result = await loadPlayersFromSheet(cfg?.sheetUrl ?? "", cachedPlayersByRoom[roomId] ?? []);
  if (result.source === "sheet") cachedPlayersByRoom[roomId] = result.players;
  return result;
}

// ─────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// PROFIL-DROPDOWN-OPTIONEN
// ─────────────────────────────────────────────────────────────
const PROFILE_BEREICHE = ["", "Marines", "Air", "Subradar", "Profit", "SAR", "Command", "Ground", "Logistik"];
const PROFILE_ROLLEN   = ["", "Flight", "Crew", "Drop", "FPS", "FOB"];
const PROFILE_STAFFELN = ["", "CER", "NEM", "TAL", "TGR", "MBA", "VPR", "HEL", "MIN", "VAN", "PAL", "IRI", "RAG"];
const PROFILE_ORTE     = [
  "", "Checkmate (Pyro)", "Orbituary (Pyro)", "RuinStation (Pyro)",
  "Orison (Crusader)", "Area18 (ArcCorp)", "Lorville (Hurston)",
  "New Babbage (microTech)", "Levski (Nyx)",
];

function ProfileSelect({ label, value, onChange, options, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-gray-400 text-xs mb-1 block">{label}</label>
      <select
        className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 appearance-none cursor-pointer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>{option === "" ? (placeholder ?? "----") : option}</option>
        ))}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PROFIL-MODAL – Spieler kann eigene Daten bearbeiten (außer AppRolle)
// ─────────────────────────────────────────────────────────────

function ProfileModal({
  player, roomId, onSave, onClose, isNew,
}: {
  player: Player; roomId: string;
  onSave: (updated: Player) => void;
  onClose: () => void;
  isNew: boolean;
}) {
  const [name, setName]         = useState(player.name);
  const [area, setArea]         = useState(player.area ?? "");
  const [role, setRole]         = useState(player.role ?? "");
  const [squadron, setSquadron] = useState(player.squadron ?? "");
  const [home, setHome]         = useState(player.homeLocation ?? "");
  const [ampel, setAmpel]       = useState(player.ampel ?? "");
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState("");

  async function handleSave() {
    if (!name.trim()) { setMsg("Name darf nicht leer sein."); return; }
    setSaving(true);
    const updated: Player = {
      ...player, name: name.trim(), area, role, squadron,
      homeLocation: home, ampel,
      // appRole bleibt unverändert – nur Admin kann das ändern
    };
    try {
      // In Firestore-Override speichern (Sheet bleibt Primärquelle)
      await saveFirestoreOverride(roomId, player.id, {
        name: updated.name, area, role, squadron,
        homeLocation: home, ampel,
      });
      onSave(updated);
    } catch (e: unknown) { setMsg(getErrorMessage(e, "Fehler beim Speichern.")); }
    setSaving(false);
  }

  const inputCls  = "w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500";
  const labelCls  = "text-gray-400 text-xs mb-1 block";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black bg-opacity-70 px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl overflow-y-auto max-h-screen">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-white font-bold text-lg">
              {isNew ? "👋 Willkommen! Profil anlegen" : "✏ Profil bearbeiten"}
            </h2>
            {isNew && (
              <p className="text-gray-400 text-xs mt-1">
                Bitte fülle dein Profil aus.
                <span className="text-yellow-400 ml-1">AppRolle wird vom Admin vergeben.</span>
              </p>
            )}
          </div>
          {!isNew && (
            <button className="text-gray-500 hover:text-gray-300 text-xl" onClick={onClose}>✕</button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {/* Name – einziges Freitext-Feld */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Handle / Name *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="KRT_Bjoern" />
          </div>

          {/* Bereich + Rolle */}
          <div className="grid grid-cols-2 gap-3">
            <ProfileSelect label="Bereich" value={area} onChange={setArea}
              options={PROFILE_BEREICHE} placeholder="----" />
            <ProfileSelect label="Rolle / Job" value={role} onChange={setRole}
              options={PROFILE_ROLLEN} placeholder="----" />
          </div>

          {/* Staffel + Heimatort */}
          <div className="grid grid-cols-2 gap-3">
            <ProfileSelect label="Staffel" value={squadron} onChange={setSquadron}
              options={PROFILE_STAFFELN} placeholder="----" />
            <ProfileSelect label="Heimatort" value={home} onChange={setHome}
              options={PROFILE_ORTE} placeholder="----" />
          </div>

          {/* Ampel */}
          <div>
            <label className={labelCls}>Skill in der Hauptpräferenz</label>
            <div className="flex gap-2 mt-1">
              {[
                { val: "gut",    label: "Gut",     color: "bg-green-700 border-green-500" },
                { val: "mittel", label: "Mittel",  color: "bg-yellow-700 border-yellow-500" },
                { val: "",       label: "Gering",  color: "bg-red-800 border-red-600" },
              ].map((opt) => (
                <button key={opt.val}
                  className={`flex-1 py-2 rounded-lg border text-xs font-medium text-white transition-opacity ${opt.color} ${ampel === opt.val ? "opacity-100 ring-2 ring-white" : "opacity-40 hover:opacity-70"}`}
                  onClick={() => setAmpel(opt.val)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* AppRolle (readonly) */}
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
            <span className="text-gray-500 text-xs">AppRolle:</span>
            <span className="text-gray-300 text-xs font-mono">{player.appRole ?? "viewer"}</span>
            <span className="text-gray-600 text-xs ml-1">(nur Admin kann ändern)</span>
          </div>

          {msg && <p className="text-red-400 text-xs">{msg}</p>}

          <div className="flex gap-2 mt-2">
            <button
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
              onClick={handleSave} disabled={saving}>
              {saving ? "Speichern…" : isNew ? "Profil anlegen & einloggen" : "Speichern"}
            </button>
            {!isNew && (
              <button className="px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg py-2 text-sm" onClick={onClose}>
                Abbrechen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOM SETUP (Admin-Konfiguration via ?setup=1)
// ─────────────────────────────────────────────────────────────

function RoomSetupView({ roomId, onDone }: { roomId: string; onDone?: (p: Player, cfg: RoomConfig) => void }) {
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetShareUrl, setSheetShareUrl] = useState("");
  const [password, setPassword] = useState("");
  const [roomName, setRoomName] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [adminHandle, setAdminHandle] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [templateRoomId, setTemplateRoomId] = useState("");
  const [availableRooms, setAvailableRooms] = useState<string[]>([]);

  useEffect(() => {
    getDocs(collection(db, "rooms"))
      .then((snap) => {
        const ids = snap.docs
          .map((d) => d.id)
          .filter((id) => id !== roomId && id.toLowerCase().includes("template"))
          .sort();
        setAvailableRooms(ids);
      })
      .catch(() => {});
  }, [roomId]);

  useEffect(() => {
    loadRoomConfig(roomId).then((cfg) => {
      if (cfg) {
        setSheetUrl(cfg.sheetUrl);
        setRoomName(cfg.roomName ?? "");
        setSheetShareUrl(cfg.sheetShareUrl ?? "");
      }
      setLoading(false);
    });
  }, [roomId]);

  async function handleSave() {
    if (!sheetUrl.startsWith("http")) {
      setMsg({ text: "sheetUrl muss mit http(s):// beginnen.", ok: false });
      return;
    }
    if (!password.trim()) {
      setMsg({ text: "Passwort darf nicht leer sein.", ok: false });
      return;
    }

    if (!adminKey.trim() || !adminHandle.trim()) {
      setMsg({ text: "Setup-Schlüssel und Admin-Handle sind erforderlich.", ok: false });
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const setupResponse = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          setupSecret: adminKey,
          sheetUrl: sheetUrl.trim(),
          sheetShareUrl: sheetShareUrl.trim(),
          password,
          roomName: roomName.trim() || roomId,
          adminHandle: adminHandle.trim(),
        }),
      });
      const setupBody = await setupResponse.json().catch(() => null) as { error?: string } | null;
      if (!setupResponse.ok) throw new Error(setupBody?.error ?? "Setup fehlgeschlagen.");

      const login = await loginToRoom({
        roomId,
        handle: adminHandle.trim(),
        password,
        signIn: (token) => signInWithCustomToken(auth, token),
      });

      let templateWarning = "";
      if (templateRoomId && templateRoomId !== roomId) {
        try {
          const templateSnap = await getDoc(doc(db, "rooms", templateRoomId, "state", "board"));
          if (templateSnap.exists()) {
            const templateData = buildRoomTemplateCopy(templateSnap.data());

            if (Object.keys(templateData).length > 0) {
              await setDoc(
                doc(db, "rooms", roomId, "state", "board"),
                { ...templateData, updatedAt: serverTimestamp() },
                { merge: true }
              );
            }
          }
        } catch (error: unknown) {
          templateWarning = ` Vorlage konnte nicht übernommen werden: ${getErrorMessage(error, "unbekannter Fehler")}`;
          console.error("[KlabsCom] Vorlage konnte nicht übernommen werden", error);
        }
      }

      invalidateRoomConfig(roomId);

      const cfg = await loadRoomConfig(roomId);
      if (onDone && cfg) {
        const adminPlayer: Player = {
          id: login.player.id,
          name: login.player.name,
          area: "",
          role: "",
          squadron: "",
          status: "",
          ampel: "",
          appRole: login.player.role,
          homeLocation: "",
        };
        onDone(adminPlayer, cfg);
        return;
      }

      setMsg({ text: `✓ Konfiguration gespeichert. Raum ist jetzt aktiv.${templateWarning}`, ok: true });
    } catch (e: unknown) {
      setMsg({ text: `Fehler: ${getErrorMessage(e, "Unbekannt")}`, ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-md shadow-xl">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-orange-400 text-lg">⚙</span>
          <h1 className="font-bold text-xl text-white">Room Setup</h1>
        </div>
        <p className="text-gray-400 text-sm mb-6">
          Raum: <span className="text-blue-400 font-mono">{roomId}</span>
        </p>

        {loading ? (
          <div className="text-gray-500 text-sm text-center py-4">Lade…</div>
        ) : (
          <>
            <label className="text-gray-300 text-xs mb-1 block">Raumname (Anzeigename)</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-4 text-sm focus:outline-none focus:border-blue-500"
              placeholder={`z.B. Alpha-Ops (Standard: ${roomId})`}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />

            <label className="text-gray-300 text-xs mb-1 block">Google Sheet CSV-URL</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-1 text-sm focus:outline-none focus:border-blue-500 font-mono"
              placeholder="https://docs.google.com/spreadsheets/d/…/export?format=csv"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
            />
            <p className="text-gray-600 text-xs mb-3">
              Sheet → Datei → Im Web veröffentlichen → CSV → URL kopieren
            </p>

            <label className="text-gray-300 text-xs mb-1 block">
              Google Sheet Freigabe-Link <span className="text-gray-500">(optional – für schnelles Teilen im Team)</span>
            </label>
            <input
              className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-1 text-sm focus:outline-none focus:border-blue-500 font-mono"
              placeholder="https://docs.google.com/spreadsheets/d/…/edit?usp=sharing"
              value={sheetShareUrl}
              onChange={(e) => setSheetShareUrl(e.target.value)}
            />
            <p className="text-gray-600 text-xs mb-4">
              Sheet → Teilen → Link kopieren (die normale /edit-URL)
            </p>

            <label className="text-gray-300 text-xs mb-1 block">
              Template laden <span className="text-gray-500">(optional – Gruppen & Karten aus bestehendem Raum übernehmen)</span>
            </label>
            <select
              className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-1 text-sm focus:outline-none focus:border-blue-500"
              value={templateRoomId}
              onChange={(e) => setTemplateRoomId(e.target.value)}
            >
              <option value="">– Kein Template –</option>
              {availableRooms.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <p className="text-gray-600 text-xs mb-4">
              Wähle einen bestehenden Raum als Vorlage. Gruppen und Karten werden kopiert – Spieler, Notizen und Tokens nicht.
            </p>

            <label className="text-gray-300 text-xs mb-1 block">Team-Passwort</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-4 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Passwort für alle Spieler dieses Raums"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <label className="text-gray-300 text-xs mb-1 block">Admin-Handle (optional)</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-4 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Dein Handle – wird als Admin angelegt"
              value={adminHandle}
              onChange={(e) => setAdminHandle(e.target.value)}
            />

            <label className="text-gray-300 text-xs mb-1 block">Setup-Schlüssel</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-5 text-sm focus:outline-none focus:border-blue-500"
              type="password"
              placeholder="Nur für Admins"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />

            <button
              className="w-full bg-orange-600 hover:bg-orange-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Speichere…" : "Konfiguration speichern"}
            </button>

            {msg && (
              <p className={`mt-3 text-xs ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.text}</p>
            )}

            <div className="mt-5 border-t border-gray-800 pt-4 text-gray-600 text-xs space-y-1">
              <p>
                Firestore-Pfad: <span className="font-mono text-gray-500">rooms/{roomId}/config/main</span>
              </p>
              <p>
                Öffentliche Felder: <span className="font-mono text-gray-500">sheetUrl</span>,{" "}
                <span className="font-mono text-gray-500">roomName</span>, Features
              </p>
              <p>
                Nach dem Speichern → Seite ohne <span className="font-mono">?setup=1</span> aufrufen.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOM PICKER – Einstiegsseite wenn kein Raum in URL
// ─────────────────────────────────────────────────────────────

function RoomPickerView({ onPick, onSetup }: {
  onPick: (roomId: string) => void;
  onSetup: (roomId: string) => void;
}) {
  const [roomInput, setRoomInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomId, setNewRoomId] = useState("");
  const [createMsg, setCreateMsg] = useState("");

  async function handleJoin() {
    const r = roomInput.trim();
    if (!r) { setMsg("Bitte einen Raum-Namen eingeben."); return; }
    setChecking(true); setMsg("");
    const cfg = await loadRoomConfig(r);
    setChecking(false);
    if (!cfg) { setMsg(`Raum „${r}" hat noch keine Konfiguration.`); return; }
    window.history.replaceState({}, "", "?room=" + encodeURIComponent(r));
    onPick(r);
  }

  function handleCreateConfirm() {
    const r = newRoomId.trim();
    if (!r) { setCreateMsg("Bitte eine Raum-ID eingeben."); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(r)) { setCreateMsg("Nur Buchstaben, Zahlen, - und _ erlaubt."); return; }
    window.history.replaceState({}, "", "?room=" + encodeURIComponent(r) + "&setup=1");
    onSetup(r);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-sm shadow-xl">
        <h1 className="font-bold text-2xl mb-1 text-white">KlabsCom</h1>
        <p className="text-gray-500 text-sm mb-6">KlabsCom <span className="text-gray-700">v{APP_VERSION}</span></p>

        <label className="text-gray-300 text-xs mb-1 block">Raum-ID</label>
        <input
          className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-4 text-sm focus:outline-none focus:border-blue-500 font-mono"
          placeholder="z.B. Alpha-Ops"
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
        />

        <button
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50 mb-2"
          onClick={handleJoin}
          disabled={checking || !roomInput.trim()}>
          {checking ? "Prüfe…" : "→ Raum beitreten"}
        </button>

        {/* Neuen Raum erstellen – mit Pflichtfeld für Raum-ID */}
        {!showCreate ? (
          <button
            className="w-full bg-orange-700 hover:bg-orange-600 text-white rounded-lg py-2 text-sm font-medium"
            onClick={() => { setShowCreate(true); setNewRoomId(""); setCreateMsg(""); }}>
            ⚙ Neuen Raum erstellen
          </button>
        ) : (
          <div className="mt-1 bg-gray-800 border border-orange-800 rounded-xl p-3">
            <p className="text-orange-300 text-xs font-semibold mb-2">⚙ Neuen Raum erstellen</p>
            <label className="text-gray-400 text-xs mb-1 block">
              Raum-ID <span className="text-red-400">*</span>
            </label>
            <input
              className="w-full bg-gray-700 border border-orange-700 text-white rounded-lg px-3 py-2 mb-1 text-sm focus:outline-none focus:border-orange-400 font-mono"
              placeholder="z.B. alpha-template"
              value={newRoomId}
              autoFocus
              onChange={(e) => { setNewRoomId(e.target.value); setCreateMsg(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleCreateConfirm()}
            />
            <p className="text-gray-600 text-xs mb-3">Nur Buchstaben, Zahlen, - und _</p>
            {createMsg && <p className="text-red-400 text-xs mb-2">{createMsg}</p>}
            <div className="flex gap-2">
              <button
                className="flex-1 bg-orange-700 hover:bg-orange-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                onClick={handleCreateConfirm}
                disabled={!newRoomId.trim()}>
                Erstellen →
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-700 text-sm"
                onClick={() => setShowCreate(false)}>
                ✕
              </button>
            </div>
          </div>
        )}

        {msg && <p className="mt-3 text-xs text-red-400">{msg}</p>}

        <p className="mt-5 text-gray-600 text-xs text-center">
          Direktlink: <span className="font-mono text-gray-500">?room=RaumName</span>
        </p>
      </div>
    </div>
  );
}

function LoginView({ roomId, onLogin, onBack }: { roomId: string; onLogin: (p: Player, cfg: RoomConfig) => void; onBack?: () => void }) {
  const [playerName, setPlayerName] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Konfigurationsstatus: null = unbekannt, false = nicht vorhanden, RoomConfig = geladen
  const [roomCfg, setRoomCfg] = useState<RoomConfig | null | false>(null);

  // Beim Mount: RoomConfig laden um zu wissen ob der Raum existiert
  useEffect(() => {
    loadRoomConfig(roomId).then((cfg) => setRoomCfg(cfg ?? false));
  }, [roomId]);

  async function handleLogin() {
    setMsg(""); setLoading(true);
    try {
      const cfg = await loadRoomConfig(roomId);
      if (!cfg) { setMsg("Dieser Raum hat noch keine Konfiguration."); setLoading(false); return; }
      const login = await loginToRoom({
        roomId,
        handle: playerName,
        password,
        signIn: (token) => signInWithCustomToken(auth, token),
      });
      const player: Player = {
        id: login.player.id,
        name: login.player.name,
        appRole: login.player.role,
        area: "",
        role: "",
        squadron: "",
        status: "",
        ampel: "",
        homeLocation: "",
      };
      setPassword("");
      onLogin(player, cfg);
    } catch (e: unknown) { setMsg(getErrorMessage(e, "Fehler.")); }
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true); setMsg("");
    try {
      // Config-Cache leeren damit eventuelle Änderungen ankommen
      invalidateRoomConfig(roomId);
      const cfg = await loadRoomConfig(roomId);
      setRoomCfg(cfg ?? false);
      if (!cfg) { setMsg("Keine Raum-Konfiguration gefunden."); setRefreshing(false); return; }
      const result = await loadPlayersForRoom(roomId, true);
      const now = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      setMsg(result.warning ?? `✓ ${result.players.length} Spieler geladen (${now})`);
    } catch {
      setMsg("Fehler beim Laden der Spielerliste.");
    }
    setRefreshing(false);
  }

  const cfgMissing = roomCfg === false;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-bold text-xl text-white">KlabsCom</h1>
          {onBack && (
            <button className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1" onClick={onBack}>
              ← Raum wählen
            </button>
          )}
        </div>
        <p className="text-gray-400 text-sm mb-1">Raum: <span className="text-blue-400 font-mono">{roomId}</span></p>

        {cfgMissing && (
          <div className="mb-4 mt-3 bg-yellow-950 border border-yellow-700 rounded-lg px-3 py-2 text-yellow-300 text-xs">
            ⚠ Dieser Raum hat noch keine Konfiguration.<br />
            Ein Admin muss den Raum über „Neuen Raum erstellen“ serverseitig einrichten.
          </div>
        )}

        {!cfgMissing && (
          <>
            <p className="text-gray-500 text-xs mb-5 mt-1">Dein Handle. Neu? Einfach einloggen – Account wird automatisch angelegt.</p>
            <label className="text-gray-300 text-xs mb-1 block">Handle / Name</label>
            <input className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-3 text-sm focus:outline-none focus:border-blue-500"
              placeholder="z.B. KRT_Bjoern" value={playerName} onChange={(e) => setPlayerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
            <label className="text-gray-300 text-xs mb-1 block">Team-Passwort</label>
            <input className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-3 text-sm focus:outline-none focus:border-blue-500"
              type="password" placeholder="Team-Passwort" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()} />

            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
              onClick={handleLogin} disabled={loading || !playerName || !password}>
              {loading ? "Einloggen..." : "Einloggen"}
            </button>
          </>
        )}

        <button className="w-full mt-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 rounded-lg py-2 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          onClick={handleRefresh} disabled={refreshing || loading}>
          <span className={refreshing ? "animate-spin inline-block" : ""}>↻</span>
          {refreshing ? "Lade…" : cfgMissing ? "Konfiguration prüfen" : "Spielerliste neu laden"}
        </button>
        {msg && (
          <p className={`mt-3 text-xs ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// INLINE EDIT
// ─────────────────────────────────────────────────────────────

function InlineEdit({ value, onSave, className = "" }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  function commit() { if (draft.trim()) onSave(draft.trim()); setEditing(false); }
  if (editing) return (
    <input className={`bg-gray-700 border border-gray-500 text-white rounded px-1 text-sm focus:outline-none ${className}`}
      value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      onClick={(e) => e.stopPropagation()} />
  );
  return (
    <span className={`cursor-text hover:text-blue-300 ${className}`}
      onClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true); }} title="Klicken zum Umbenennen">
      {value} <span className="text-gray-600 text-xs">✎</span>
    </span>
  );
}


// Small helper: renders a group icon (emoji or URL image)
function GroupIconDisplay({ icon, size = 20 }: { icon?: string; size?: number }) {
  if (!icon) return null;
  const isUrl = icon.startsWith("http") || icon.startsWith("/");
  if (isUrl) {
    const src = icon.includes("drive.google.com/file/d/")
      ? icon.replace(/drive\.google\.com\/file\/d\/([^/]+).*/, "drive.google.com/uc?export=view&id=$1")
      : icon;
    return <img src={src} style={{ width: size, height: size, borderRadius: 3, objectFit: "cover", flexShrink: 0 }} alt="icon" />;
  }
  return <span style={{ fontSize: size * 0.85, lineHeight: 1, flexShrink: 0 }}>{icon}</span>;
}

// ─────────────────────────────────────────────────────────────
// GROUP ICON PICKER
// ─────────────────────────────────────────────────────────────

// Gruppen-Icons: militärisch & Star Citizen thematisch, in Kategorien
const EMOJI_ICON_GROUPS: { label: string; icons: string[] }[] = [
  { label: "Einheit / Rolle",  icons: ["⚔","🗡","🛡","🪖","🎖","🏅","☠","💀","🔱","⚜","👁","🧠","🦾","🤺","🫡","🧬","⚙","🔧","🛠","🔩"] },
  { label: "Raumschiff / Fahrzeug", icons: ["🚀","🛸","🛩","🛰","🌌","🪐","🌠","💫","🌑","🌒","🔭","🛟","⚓","🛡","🗺","📍"] },
  { label: "Waffe / Kampf",   icons: ["💥","⚡","🔥","❄","☢","☣","💣","🎯","🧨","🪤","🔫","🗡","⚔","🪃","🏹","💢","🌀","🌪","🔆","⚠"] },
  { label: "Signal / Status", icons: ["🚩","🏴","📡","📻","⛔","🚫","❗","❓","🔒","🔓","🕵","📌","🗂","📂","🔐","🛑","✴","☢","☣","⚠"] },
  { label: "Sci-Fi / Lore",   icons: ["🌐","🔮","💠","🧿","🪬","🏛","⚗","🧪","🪙","💎","🧲","🔋","💡","🖥","🕹","🤖","👾","🎮","🃏","🎴"] },
];

function GroupIconPicker({ current, onChange }: { current?: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [tab, setTab] = useState<"emoji" | "url">("emoji");

  function handleUrl() {
    const v = urlInput.trim();
    if (v) { onChange(v); setOpen(false); setUrlInput(""); }
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
    setOpen(false);
  }

  // Preview: emoji or img
  const isUrl = current && (current.startsWith("http") || current.startsWith("/"));
  const preview = current
    ? isUrl
      ? <img src={current} className="w-5 h-5 rounded object-cover" alt="icon" onError={(event: React.SyntheticEvent<HTMLImageElement>) => { event.currentTarget.style.display = "none"; }} />
      : <span className="text-base leading-none">{current}</span>
    : <span className="text-gray-500 text-xs">🖼</span>;

  return (
    <div className="relative">
      <button
        className="w-6 h-6 rounded border border-gray-600 flex items-center justify-center flex-shrink-0 hover:ring-2 hover:ring-white bg-gray-800"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        title="Gruppen-Icon wählen"
      >{preview}</button>

      {open && (
        <div
          className="absolute top-8 left-0 z-50 bg-gray-900 border border-gray-600 rounded-xl p-2 shadow-2xl"
          style={{ width: 240 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Tabs */}
          <div className="flex gap-1 mb-2">
            <button onClick={() => setTab("emoji")}
              className={`flex-1 text-xs py-1 rounded border transition-colors ${tab === "emoji" ? "bg-blue-700 border-blue-500 text-white" : "bg-gray-800 border-gray-600 text-gray-400"}`}>
              Emoji
            </button>
            <button onClick={() => setTab("url")}
              className={`flex-1 text-xs py-1 rounded border transition-colors ${tab === "url" ? "bg-blue-700 border-blue-500 text-white" : "bg-gray-800 border-gray-600 text-gray-400"}`}>
              URL / Drive
            </button>
          </div>

          {tab === "emoji" && (
            <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-0.5">
              {EMOJI_ICON_GROUPS.map((grp) => (
                <div key={grp.label}>
                  <div className="text-gray-600 text-[10px] font-semibold uppercase tracking-wide mb-0.5 px-0.5">{grp.label}</div>
                  <div className="flex flex-wrap gap-0.5">
                    {grp.icons.map((em) => (
                      <button key={em}
                        className={`w-8 h-8 rounded text-lg hover:bg-gray-700 flex items-center justify-center border transition-colors ${current === em ? "border-blue-400 bg-blue-900" : "border-transparent"}`}
                        onClick={() => { onChange(em); setOpen(false); }}>{em}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "url" && (
            <div className="flex flex-col gap-2">
              <input
                className="w-full bg-gray-800 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
                placeholder="https://... oder Drive-URL"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") handleUrl(); }}
              />
              <button className="w-full bg-blue-700 hover:bg-blue-600 text-white text-xs rounded py-1.5 font-medium" onClick={handleUrl}>
                Übernehmen
              </button>
              <p className="text-gray-600 text-xs text-center">Google Drive: drive.google.com/file/d/…</p>
            </div>
          )}

          {current && (
            <button className="w-full mt-2 text-xs text-red-400 hover:text-red-300 border-t border-gray-700 pt-1.5" onClick={handleClear}>
              ✕ Icon entfernen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DRAG HANDLE (9-dot SVG)
// ─────────────────────────────────────────────────────────────
function DragHandle({ listeners, attributes }: { listeners?: object; attributes?: object }) {
  return (
    <div
      {...(listeners ?? {})}
      {...(attributes ?? {})}
      className="cursor-grab active:cursor-grabbing flex-shrink-0 flex items-center justify-center p-1 rounded hover:bg-gray-700 transition-colors touch-none select-none"
      title="Ziehen zum Verschieben"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" className="text-gray-500">
        <circle cx="3"  cy="3"  r="1.5"/>
        <circle cx="7"  cy="3"  r="1.5"/>
        <circle cx="11" cy="3"  r="1.5"/>
        <circle cx="3"  cy="7"  r="1.5"/>
        <circle cx="7"  cy="7"  r="1.5"/>
        <circle cx="11" cy="7"  r="1.5"/>
        <circle cx="3"  cy="11" r="1.5"/>
        <circle cx="7"  cy="11" r="1.5"/>
        <circle cx="11" cy="11" r="1.5"/>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SYSTEM CHIP – kompakter 2-Buchstaben Chip für Gruppe
// ─────────────────────────────────────────────────────────────
const SYSTEM_ABBR: Record<string, { short: string; color: string; bg: string }> = {
  stanton: { short: "ST", color: "#93c5fd", bg: "#1e3a5f" },
  pyro:    { short: "PY", color: "#fca5a5", bg: "#5f1e1e" },
  nyx:     { short: "NY", color: "#86efac", bg: "#1e3d2f" },
};

function SystemChip({ systemId, systems, canChange, onChange }: {
  systemId: string; systems: StarSystem[]; canChange: boolean;
  onChange?: (sysId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const info = SYSTEM_ABBR[systemId] ?? { short: systemId.slice(0,2).toUpperCase(), color: "#9ca3af", bg: "#374151" };
  return (
    <div className="relative flex-shrink-0">
      <button
        className="text-xs font-bold px-1.5 py-0.5 rounded border select-none"
        style={{ color: info.color, backgroundColor: info.bg, borderColor: info.color + "55" }}
        onClick={(e) => { e.stopPropagation(); if (canChange) setOpen(v => !v); }}
        title={systems.find(s => s.id === systemId)?.label ?? systemId}
        onPointerDown={(e) => e.stopPropagation()}>
        {info.short}
      </button>
      {open && canChange && (
        <div className="absolute top-full left-0 mt-1 bg-gray-900 border border-gray-600 rounded-xl shadow-xl p-1 z-50 min-w-max"
          onPointerDown={(e) => e.stopPropagation()}>
          {systems.map((s) => {
            const si = SYSTEM_ABBR[s.id] ?? { short: s.id.slice(0,2).toUpperCase(), color: "#9ca3af", bg: "#374151" };
            return (
              <button key={s.id}
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg hover:bg-gray-800 text-xs"
                onClick={(e) => { e.stopPropagation(); onChange?.(s.id); setOpen(false); }}>
                <span className="font-bold px-1.5 py-0.5 rounded" style={{ color: si.color, backgroundColor: si.bg }}>{si.short}</span>
                <span className="text-gray-300">{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PLAYER CARD
// ─────────────────────────────────────────────────────────────

function Card({ player, aliveState, currentPlayerId, canWrite, isAdmin, onToggleAlive, spawnGroups, spawnState, onSetSpawn,
  groupRoles, groupId, onSetRole, onSetAppRole, onSetPlayerField,
}: {
  player: Player; aliveState: PlayerAliveState; currentPlayerId: string; canWrite: boolean; isAdmin: boolean;
  onToggleAlive: (id: string) => void; spawnGroups: Group[]; spawnState: PlayerSpawnState;
  onSetSpawn: (pid: string, sid: string) => void;
  groupRoles: GroupRoles; groupId: string; onSetRole: (gId: string, pid: string, role: "leader" | "deputy" | null) => void;
  onSetAppRole: (pid: string, role: "admin" | "commander" | "viewer") => void;
  onSetPlayerField: (pid: string, field: EditablePlayerField, value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: player.id });
  const isDead = aliveState[player.id] === "dead";
  const isSelf = player.id === currentPlayerId;
  const canToggle = isSelf || canWrite;

  const gr = groupRoles[groupId] ?? {};
  const isLeader  = gr.leader  === player.id;
  const isDeputy  = gr.deputy  === player.id;

  return (
    <div ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`rounded-xl border shadow-sm transition-all ${isDead ? "bg-gray-900 border-red-900 opacity-70" : "bg-gray-800 border-gray-700"}`}>
      <div className="px-2 pt-2 pb-1 select-none"
        style={{ borderLeft: `3px solid ${ampelColor(player.ampel)}`, paddingLeft: 8 }}>

        {/* Zeile 1: Handle + Name + Alive-Button */}
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <DragHandle listeners={listeners} attributes={attributes} />
          <div className={`font-semibold text-sm leading-tight flex-1 break-words ${isDead ? "line-through text-gray-500" : "text-white"}`}>
            {player.name}
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
            {canToggle && (
              <button
                className={`text-xs px-1.5 py-0.5 rounded border font-bold transition-colors ${
                  isDead ? "bg-red-950 border-red-700 text-red-300 hover:bg-red-900" : "bg-green-950 border-green-700 text-green-300 hover:bg-green-900"
                }`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onToggleAlive(player.id); }}>
                {isDead ? "☠" : "✓"}
              </button>
            )}
            {!canToggle && isDead && <span className="text-red-500 text-xs flex-shrink-0">☠</span>}
          </div>
        </div>

        {/* Zeile 2: Sterne-Anzeige | Icon | IconPicker | Heimatort | Sterne-Buttons */}
        <div className="flex items-center gap-1 min-w-0" onPointerDown={(e) => e.stopPropagation()}>
          {/* Rang-Anzeige (readonly) */}
          {isLeader && <span className="text-yellow-400 text-xs flex-shrink-0" title="Gruppenleader">★★</span>}
          {isDeputy && <span className="text-yellow-400 text-xs flex-shrink-0" title="Stellvertreter">★</span>}
          {/* Icon anzeigen */}
          {player.icon && <GroupIconDisplay icon={player.icon} size={13} />}
          {/* Icon-Picker */}
          {(isSelf || canWrite) && (
            <GroupIconPicker current={player.icon} onChange={(icon) => onSetPlayerField(player.id, "icon", icon)} />
          )}
          {/* Heimatort */}
          {player.homeLocation && (
            <span className="text-gray-500 text-xs truncate flex-1 min-w-0" title={player.homeLocation}>
              📍{player.homeLocation}
            </span>
          )}
          {/* Rang-Buttons (nur für canWrite in echter Gruppe) */}
          {canWrite && groupId !== "unassigned" && (
            <>
              <button className={`text-xs px-1 rounded ml-auto flex-shrink-0 ${isLeader ? "text-yellow-400" : "text-gray-600 hover:text-yellow-500"}`}
                title={isLeader ? "Leader entfernen" : "Zum Leader machen"}
                onClick={(e) => { e.stopPropagation(); onSetRole(groupId, player.id, isLeader ? null : "leader"); }}>
                ★★
              </button>
              <button className={`text-xs px-1 rounded flex-shrink-0 ${isDeputy ? "text-yellow-400" : "text-gray-600 hover:text-yellow-500"}`}
                title={isDeputy ? "Deputy entfernen" : "Zum Stellvertreter machen"}
                onClick={(e) => { e.stopPropagation(); onSetRole(groupId, player.id, isDeputy ? null : "deputy"); }}>
                ★
              </button>
            </>
          )}
        </div>

      </div>
      {/* Kompakte Dropdown-Zeile: Bereich + Staffel (für alle sichtbar) */}
      {(isSelf || canWrite) && (
        <div className="px-2 pb-1 grid grid-cols-2 gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <select
            className="bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded px-1 py-0.5 focus:outline-none"
            value={player.area ?? ""}
            disabled={!isSelf && !canWrite}
            onChange={(e) => onSetPlayerField(player.id, "area", e.target.value)}
            title="Bereich">
            {PROFILE_BEREICHE.map((o) => <option key={o} value={o}>{o || "Bereich…"}</option>)}
          </select>
          <select
            className="bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded px-1 py-0.5 focus:outline-none"
            value={player.squadron ?? ""}
            disabled={!isSelf && !canWrite}
            onChange={(e) => onSetPlayerField(player.id, "squadron", e.target.value)}
            title="Staffel">
            {PROFILE_STAFFELN.map((o) => <option key={o} value={o}>{o || "Staffel…"}</option>)}
          </select>
        </div>
      )}
      {/* Spawn + AppRole */}
      {(isSelf || canWrite) && (spawnGroups.length > 0 || (canWrite && isAdmin)) && (
        <div className="px-2 pb-2 grid grid-cols-2 gap-1" onPointerDown={(e) => e.stopPropagation()}>
          {spawnGroups.length > 0 && (
            <select
              className="bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded px-1 py-0.5 focus:outline-none"
              value={spawnState[player.id] ?? ""}
              onChange={(e) => onSetSpawn(player.id, e.target.value)}>
              <option value="">Spawn…</option>
              {spawnGroups.map((sg) => <option key={sg.id} value={sg.id}>{sg.label}</option>)}
            </select>
          )}
          {canWrite && isAdmin && (
            <select
              className="bg-gray-700 border border-orange-700 text-orange-300 text-xs rounded px-1 py-0.5 focus:outline-none"
              value={player.appRole ?? "viewer"}
              onChange={(e) => onSetAppRole(player.id, e.target.value as "admin" | "commander" | "viewer")}
              title="AppRolle setzen">
              <option value="viewer">viewer</option>
              <option value="commander">commander</option>
              <option value="admin">admin</option>
            </select>
          )}
        </div>
      )}
    </div>
  );
}

// ── Block 1a: React.memo für Card (nach Card, vor SpawnBar) ────────────────
const CardMemo = React.memo(Card, (prev, next) =>
  prev.player === next.player &&
  prev.aliveState[prev.player.id] === next.aliveState[next.player.id] &&
  prev.groupRoles[prev.groupId] === next.groupRoles[next.groupId] &&
  prev.canWrite === next.canWrite &&
  prev.currentPlayerId === next.currentPlayerId &&
  prev.spawnState[prev.player.id] === next.spawnState[next.player.id]
);

// ─────────────────────────────────────────────────────────────
// SPAWN BAR
// ─────────────────────────────────────────────────────────────

function SpawnBar({ spawnGroups, board, playersById, aliveState, canWrite, onRename, onDelete, onClear }: {
  spawnGroups: Group[]; board: BoardState; playersById: Record<string, Player>;
  aliveState: PlayerAliveState; canWrite: boolean;
  onRename: (id: string, label: string) => void; onDelete: (id: string) => void; onClear: (id: string) => void;
}) {
  if (spawnGroups.length === 0) return null;
  return (
    <div className="flex gap-2 flex-wrap mb-3">
      {spawnGroups.map((g) => {
        const ids = board.columns[g.id] ?? [];
        return (
          <div key={g.id} className="rounded-xl border border-yellow-800 bg-gray-900 flex flex-col min-w-[200px] max-w-[280px]">
            {/* Header */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-yellow-900">
              <span className="text-yellow-400 text-xs font-semibold flex items-center gap-1 flex-1 min-w-0">
                ⚓ {canWrite ? <InlineEdit value={g.label} onSave={(v) => onRename(g.id, v)} /> : g.label}
                <span className="text-gray-500 font-normal">({ids.filter((pid: string) => !!playersById[pid]).length})</span>
              </span>
              {canWrite && (
                <div className="flex gap-1 flex-shrink-0">
                  <button className="text-xs text-gray-600 hover:text-yellow-400" onClick={() => onClear(g.id)} title="Leeren">↩</button>
                  <button className="text-xs text-gray-600 hover:text-red-500" onClick={() => onDelete(g.id)} title="Löschen">✕</button>
                </div>
              )}
            </div>
            {/* Drop-Zone mit DnD-fähigen Karten */}
            <SpawnDropZone groupId={g.id}>
              <SortableContext items={ids} strategy={rectSortingStrategy}>
                <div className="px-2 py-1.5 flex flex-col gap-1 min-h-[32px]">
                  {ids.length === 0 && (
                    <div className="text-xs text-gray-600 border border-dashed border-yellow-900 rounded p-2 text-center">hierher ziehen</div>
                  )}
                  {ids.map((pid) => {
                    const p = playersById[pid];
                    if (!p) return null;
                    return <SpawnPlayerCard key={pid} player={p} aliveState={aliveState} />;
                  })}
                </div>
              </SortableContext>
            </SpawnDropZone>
          </div>
        );
      })}
    </div>
  );
}

function SpawnDropZone({ groupId, children }: { groupId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: groupId });
  return (
    <div ref={setNodeRef} className={`flex-1 rounded-b-xl transition-colors ${isOver ? "bg-yellow-950" : ""}`}>
      {children}
    </div>
  );
}

function SpawnPlayerCard({ player, aliveState }: { player: Player; aliveState: PlayerAliveState }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: player.id });
  const isDead = aliveState[player.id] === "dead";
  return (
    <div ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`text-xs px-1 py-1 rounded border flex items-center gap-1 select-none ${
        isDead ? "border-red-800 text-red-400 line-through" : "border-yellow-800 text-gray-300 hover:border-yellow-600"
      }`}>
      <DragHandle listeners={listeners} attributes={attributes} />
      <span>{player.name}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COLOR PICKER POPOVER
// ─────────────────────────────────────────────────────────────

function ColorPicker({ current, onChange }: { current?: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="w-4 h-4 rounded-full border border-gray-600 flex-shrink-0 hover:ring-2 hover:ring-white"
        style={{ backgroundColor: current ? `#${current}` : "#3b82f6" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        title="Farbe wählen"
      />
      {open && (
        <div className="absolute top-6 left-0 z-50 bg-gray-800 border border-gray-600 rounded-lg p-2 shadow-xl flex flex-wrap gap-1" style={{ width: 120 }}
          onPointerDown={(e) => e.stopPropagation()}>
          {GROUP_COLORS.map((c) => (
            <button key={c.hex}
              className={`w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform ${current === c.hex ? "border-white" : "border-transparent"}`}
              style={{ backgroundColor: `#${c.hex}` }}
              title={c.label}
              onClick={(e) => { e.stopPropagation(); onChange(c.hex); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DROPPABLE COLUMN  (jetzt mit Gruppen-DnD, Farbe, Rollen)
// ─────────────────────────────────────────────────────────────

const COLUMN_HEIGHT = 760;

function DroppableColumn({ group, ids, playersById, aliveState, currentPlayerId, canWrite, isAdmin, onToggleAlive,
  onRename, onDelete, onClear, spawnGroups, spawnState, onSetSpawn, groupRoles, onSetRole, onSetAppRole, onSetPlayerField, onSetColor, onSetIcon,
  systems, onSetSystem,
}: {
  group: Group; ids: string[]; playersById: Record<string, Player>; aliveState: PlayerAliveState;
  currentPlayerId: string; canWrite: boolean;
  onToggleAlive: (id: string) => void; onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void; onClear?: () => void;
  spawnGroups: Group[]; spawnState: PlayerSpawnState; onSetSpawn: (pid: string, sid: string) => void;
  groupRoles: GroupRoles; onSetRole: (gId: string, pid: string, role: "leader" | "deputy" | null) => void;
  isAdmin: boolean; onSetAppRole: (pid: string, role: "admin" | "commander" | "viewer") => void;
  onSetPlayerField: (pid: string, field: EditablePlayerField, value: string) => void;
  onSetColor: (id: string, hex: string) => void;
  onSetIcon: (id: string, icon: string) => void;
  systems?: StarSystem[]; onSetSystem?: (sysId: string) => void;
}) {
  // useSortable für Spalten-Drag (Gruppe verschieben) + useDroppable für Spieler-Drop
  const {
    attributes: colAttrs,
    listeners: colListeners,
    setNodeRef: setSortableRef,
    transform: colTransform,
    transition: colTransition,
    isDragging: colIsDragging,
  } = useSortable({ id: group.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: group.id });

  // Beide Refs zusammenführen
  const setRef = (el: HTMLDivElement | null) => { setSortableRef(el); setDropRef(el); };

  const safeIds = ids ?? [];
  const knownIds = safeIds.filter((pid) => !!playersById[pid]);
  const deadCount = knownIds.filter((pid) => aliveState[pid] === "dead").length;
  const isSystem = group.id === "unassigned";
  const gColor = groupColor(group);

  return (
    <div
      style={{
        width: 230, flexShrink: 0,
        transform: CSS.Transform.toString(colTransform),
        transition: colTransition,
        opacity: colIsDragging ? 0.5 : 1,
        zIndex: colIsDragging ? 50 : undefined,
      }}>
      <div ref={setRef}
        className={`rounded-xl border flex flex-col transition-colors ${isOver && !colIsDragging ? "border-blue-500 bg-gray-700" : "border-gray-700 bg-gray-900"}`}
        style={{ height: COLUMN_HEIGHT }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 flex-shrink-0"
          style={{ borderTop: `3px solid ${gColor}` }}>
          <div className="font-semibold text-sm flex items-center gap-1 min-w-0 flex-1 text-white">
            {/* Drag-Handle für Spalte (nur Admin/Commander) */}
            {canWrite && !isSystem && (
              <span
                {...colAttrs} {...colListeners}
                className="text-gray-500 hover:text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0 px-0.5"
                title="Spalte verschieben"
              >⠿</span>
            )}
            {/* System-Chip */}
            {!isSystem && systems && (
              <SystemChip systemId={group.systemId ?? "stanton"} systems={systems} canChange={canWrite} onChange={onSetSystem} />
            )}
            {/* Farbwähler */}
            {canWrite && !isSystem && (
              <ColorPicker current={group.color} onChange={(hex) => onSetColor(group.id, hex)} />
            )}
            {/* Icon-Wähler */}
            {canWrite && !isSystem && (
              <GroupIconPicker current={group.icon} onChange={(icon) => onSetIcon(group.id, icon)} />
            )}
            {/* Icon-Anzeige (readonly) */}
            {!canWrite && !isSystem && group.icon && (
              <GroupIconDisplay icon={group.icon} size={18} />
            )}
            {canWrite && !isSystem
              ? <InlineEdit value={group.label} onSave={(v) => onRename(group.id, v)} className="flex-1" />
              : <span className="truncate">{group.label}</span>}
            <span className="text-gray-500 font-normal text-xs flex-shrink-0">({knownIds.length})</span>
            {deadCount > 0 && <span className="text-red-500 text-xs flex-shrink-0">☠{deadCount}</span>}
          </div>
          <div className="flex gap-1 flex-shrink-0">
            {onClear && canWrite && (
              <button className="text-xs text-gray-600 hover:text-yellow-400" onClick={onClear} title="Leeren">↩</button>
            )}
            {canWrite && !isSystem && (
              <button className="text-xs text-gray-600 hover:text-red-500" onClick={() => onDelete(group.id)} title="Löschen">✕</button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1" style={{ maxHeight: COLUMN_HEIGHT - 44 }}>
          <SortableContext items={safeIds} strategy={rectSortingStrategy}>
            {safeIds.length === 0 && (
              <div className="text-xs text-gray-600 border border-dashed border-gray-700 rounded-lg p-4 text-center">hierher ziehen</div>
            )}
            {safeIds.map((pid) =>
              playersById[pid] ? (
                <CardMemo key={pid} player={playersById[pid]} aliveState={aliveState} currentPlayerId={currentPlayerId}
                  canWrite={canWrite} onToggleAlive={onToggleAlive} spawnGroups={spawnGroups}
                  spawnState={spawnState} onSetSpawn={onSetSpawn}
                  groupRoles={groupRoles} groupId={group.id} onSetRole={onSetRole}
                  isAdmin={isAdmin} onSetAppRole={onSetAppRole} onSetPlayerField={onSetPlayerField} />
              ) : null
            )}
          </SortableContext>
        </div>
      </div>
    </div>
  );
}

// ── Block 1b: React.memo für DroppableColumn ───────────────────────────────
const DroppableColumnMemo = React.memo(DroppableColumn, (prev, next) =>
  prev.group === next.group &&
  prev.ids === next.ids &&
  prev.aliveState === next.aliveState &&
  prev.canWrite === next.canWrite &&
  prev.groupRoles === next.groupRoles &&
  prev.currentPlayerId === next.currentPlayerId &&
  prev.spawnState === next.spawnState
);

// ─────────────────────────────────────────────────────────────
// MAP NAV – Doppelklick zum Wechseln, Einfachklick nur Auswahl
// ─────────────────────────────────────────────────────────────

function MapNavPanel({ maps, pois, activeMapId, setActiveMapId, isAdmin, onRenameMap, onDeleteMap,
  onAddSubmap, onRenamePOI, onDeletePOI, onAddPOI, onSetMapImage, onReorderMaps, onReorderPOIs,
}: {
  maps: MapEntry[]; pois: POI[]; activeMapId: string; setActiveMapId: (id: string) => void;
  isAdmin: boolean; onRenameMap: (id: string, label: string) => void; onDeleteMap: (id: string) => void;
  onAddSubmap: () => void; onRenamePOI: (id: string, label: string) => void;
  onDeletePOI: (id: string) => void; onAddPOI: (parentMapId: string) => void;
  onSetMapImage: (id: string, image: string) => void;
  onReorderMaps: (newOrder: string[]) => void;
  onReorderPOIs: (parentMapId: string, newOrder: string[]) => void;
}) {
  const submaps = maps.filter((m) => m.id !== "main");
  const [submapsOpen, setSubmapsOpen] = useState(true);
  const [poisOpen, setPoisOpen] = useState<Record<string, boolean>>({});
  const togglePois = (id: string) => setPoisOpen(p => ({ ...p, [id]: !(p[id] ?? true) }));
  const navSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleSubmapDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = submaps.map((m) => m.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    onReorderMaps(arrayMove(ids, oldIdx, newIdx));
  }

  return (
    <div className="space-y-1">
      {/* Hauptkarte */}
      <MapNavRow map={maps.find((m) => m.id === "main")!} activeMapId={activeMapId}
        setActiveMapId={setActiveMapId} isAdmin={isAdmin} canDelete={false}
        onRename={(v) => onRenameMap("main", v)} onDelete={() => {}}
        onSetImage={(img) => onSetMapImage("main", img)} indent={0} />

      {/* Unterkarten – collapsible + draggable */}
      {submaps.length > 0 && (
        <div>
          <button
            className="flex items-center gap-1 w-full text-xs text-gray-500 hover:text-gray-300 px-1 py-0.5 rounded select-none"
            onClick={() => setSubmapsOpen(v => !v)}>
            <span className="text-gray-600">{submapsOpen ? "▾" : "▸"}</span>
            <span>Unterkarten ({submaps.length})</span>
          </button>
          {submapsOpen && (
            <DndContext sensors={navSensors} onDragEnd={handleSubmapDragEnd}>
              <SortableContext items={submaps.map((m) => m.id)} strategy={rectSortingStrategy}>
                {submaps.map((sm) => {
                  const smPois = pois.filter((p) => p.parentMapId === sm.id);
                  const pOpen = poisOpen[sm.id] ?? true;
                  return (
                    <SortableMapRow key={sm.id} map={sm} activeMapId={activeMapId} setActiveMapId={setActiveMapId}
                      isAdmin={isAdmin} canDelete={isAdmin}
                      onRename={(v) => onRenameMap(sm.id, v)} onDelete={() => onDeleteMap(sm.id)}
                      onSetImage={(img) => onSetMapImage(sm.id, img)}>
                      {/* POIs – collapsible per submap, + POI inline im Header */}
                      <div className="ml-4">
                        <div className="flex items-center gap-1">
                          {smPois.length > 0 && (
                            <button
                              className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 select-none flex-1"
                              onClick={() => togglePois(sm.id)}>
                              <span>{pOpen ? "▾" : "▸"}</span>
                              <span>POIs ({smPois.length})</span>
                            </button>
                          )}
                          {isAdmin && (
                            <button className="text-xs px-1.5 py-0.5 rounded border border-gray-700 text-gray-600 hover:text-green-400 hover:border-green-800 ml-auto"
                              onClick={() => onAddPOI(sm.id)} title="POI hinzufügen">+ POI</button>
                          )}
                        </div>
                        {pOpen && smPois.length > 0 && (
                          <DndContext sensors={navSensors}
                            onDragEnd={(e: DragEndEvent) => {
                              const { active, over } = e;
                              if (!over || active.id === over.id) return;
                              const ids = smPois.map((p) => p.id);
                              onReorderPOIs(sm.id, arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
                            }}>
                            <SortableContext items={smPois.map((p) => p.id)} strategy={rectSortingStrategy}>
                              {smPois.map((poi) => (
                                <SortableMapRow key={poi.id} map={{ ...poi }} activeMapId={activeMapId}
                                  setActiveMapId={setActiveMapId} isAdmin={isAdmin} canDelete={isAdmin}
                                  onRename={(v) => onRenamePOI(poi.id, v)} onDelete={() => onDeletePOI(poi.id)}
                                  onSetImage={(img) => onSetMapImage(poi.id, img)} isPOI indent={2}>
                                </SortableMapRow>
                              ))}
                            </SortableContext>
                          </DndContext>
                        )}
                      </div>
              </SortableMapRow>
            );
          })}
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
      {isAdmin && (
        <button className="w-full mt-1 text-xs px-2 py-1 rounded-lg border border-gray-700 text-gray-500 hover:text-gray-300 hover:bg-gray-800"
          onClick={onAddSubmap}>+ Unterkarte</button>
      )}
    </div>
  );
}

function MapNavRow({ map, activeMapId, setActiveMapId, isAdmin, canDelete, onRename, onDelete, onSetImage, indent, isPOI, dragListeners, dragAttributes }: {
  map: { id: string; label: string; image: string }; activeMapId: string;
  setActiveMapId: (id: string) => void; isAdmin: boolean; canDelete: boolean;
  onRename: (v: string) => void; onDelete: () => void; onSetImage: (img: string) => void;
  indent: number; isPOI?: boolean; dragListeners?: DraggableSyntheticListeners; dragAttributes?: DraggableAttributes;
}) {
  const [showUrl, setShowUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(map.image);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isActive = activeMapId === map.id;
  const icon = indent === 0 ? "🗺" : isPOI ? "🔵" : "📍";
  const ml = indent === 0 ? "" : indent === 1 ? "ml-4" : "ml-8";

  // BUGFIX: Doppelklick → Karte wechseln; Einfachklick → nur highlight (kein ungewollter Wechsel beim Draggen)
  const clickCount = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleClick() {
    clickCount.current += 1;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    if (clickCount.current >= 2) {
      // Doppelklick → wechseln
      setActiveMapId(map.id);
      clickCount.current = 0;
      return;
    }
    // Hauptkarte: Einfachklick reicht
    if (indent === 0) {
      setActiveMapId(map.id);
      clickCount.current = 0;
      return;
    }
    clickTimer.current = setTimeout(() => { clickCount.current = 0; }, 350);
  }

  return (
    <div className={ml}>
      <div className="flex items-center gap-1">
        {indent > 0 && <div className="w-3 h-px bg-gray-600 flex-shrink-0" />}
        <button
          className={`flex-1 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors min-w-0 ${
            isActive ? "bg-blue-900 border-blue-600 text-blue-200" : "bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-white"
          }`}
          onClick={handleClick}
          title={indent > 0 ? "Doppelklick zum Wechseln" : undefined}
        >
          <span className="flex items-center gap-1">
            {dragListeners && (
              <span {...dragListeners} {...dragAttributes}
                className="cursor-grab active:cursor-grabbing flex-shrink-0 touch-none select-none"
                onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); dragListeners.onPointerDown?.(event); }}>
                <svg width="10" height="7" viewBox="0 0 10 7" fill="currentColor" className="text-gray-500 opacity-60">
                  <circle cx="2" cy="1.5" r="1.2"/><circle cx="5" cy="1.5" r="1.2"/><circle cx="8" cy="1.5" r="1.2"/>
                  <circle cx="2" cy="5.5" r="1.2"/><circle cx="5" cy="5.5" r="1.2"/><circle cx="8" cy="5.5" r="1.2"/>
                </svg>
              </span>
            )}
            {icon}
            {isAdmin && indent > 0 ? <InlineEdit value={map.label} onSave={onRename} /> : <span className="truncate">{map.label}</span>}
            <span className={`text-xs flex-shrink-0 ${map.image ? "text-green-600" : "text-gray-700"}`}>{map.image ? "●" : "○"}</span>
            {indent > 0 && <span className="text-gray-600 text-xs ml-auto">↵↵</span>}
          </span>
        </button>
        {isAdmin && (
          <button className={`text-xs px-1 flex-shrink-0 ${showUrl ? "text-blue-400" : "text-gray-600 hover:text-blue-400"}`}
            onClick={() => { setUrlDraft(map.image); setShowUrl((value) => !value); }} title="Bild-URL">🖼</button>
        )}
        {canDelete && !confirmDelete && (
          <button className="text-xs text-gray-600 hover:text-red-500 px-1 flex-shrink-0"
            onClick={() => setConfirmDelete(true)} title="Löschen">✕</button>
        )}
        {canDelete && confirmDelete && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button className="text-xs px-1 py-0.5 rounded bg-red-900 border border-red-700 text-red-300 hover:bg-red-700 font-bold"
              onClick={() => { onDelete(); setConfirmDelete(false); }} title="Bestätigen">✓</button>
            <button className="text-xs px-1 py-0.5 rounded border border-gray-600 text-gray-400 hover:bg-gray-700"
              onClick={() => setConfirmDelete(false)} title="Abbrechen">✕</button>
          </div>
        )}
      </div>
      {showUrl && isAdmin && (
        <div className={`mt-1 ${indent > 0 ? "ml-4" : ""}`}>
          <div className="text-xs text-gray-500 mb-1">Bild-URL (https://… oder /maps/…)</div>
          <div className="flex gap-1">
            <input className="flex-1 bg-gray-800 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              placeholder="https://example.com/karte.png" value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const normalized = normalizeImageUrl(urlDraft.trim());
                  if (urlDraft.trim() && !normalized) { alert("Google Docs/Sheets können nicht als Bild verwendet werden."); return; }
                  onSetImage(normalized); setShowUrl(false);
                }
              }} autoFocus />
            <button className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 rounded flex-shrink-0"
              onClick={() => {
                const normalized = normalizeImageUrl(urlDraft.trim());
                if (urlDraft.trim() && !normalized) { alert("Google Docs/Sheets können nicht als Bild verwendet werden."); return; }
                onSetImage(normalized); setShowUrl(false);
              }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Sortierbare Wrapper-Komponente für Unterkarten und POIs im MapNavPanel
function SortableMapRow({ map, activeMapId, setActiveMapId, isAdmin, canDelete, onRename, onDelete,
  onSetImage, isPOI, indent = 1, children }: {
  map: { id: string; label: string; image: string }; activeMapId: string;
  setActiveMapId: (id: string) => void; isAdmin: boolean; canDelete: boolean;
  onRename: (v: string) => void; onDelete: () => void; onSetImage: (img: string) => void;
  isPOI?: boolean; indent?: number; children?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: map.id });
  return (
    <div ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="mt-0.5">
      <MapNavRow map={map} activeMapId={activeMapId} setActiveMapId={setActiveMapId}
        isAdmin={isAdmin} canDelete={canDelete}
        onRename={onRename} onDelete={onDelete}
        onSetImage={onSetImage} indent={indent} isPOI={isPOI}
        dragListeners={listeners} dragAttributes={attributes} />
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TOKEN PLACER
// ─────────────────────────────────────────────────────────────

function TokenPlacerPanel({ groups, onPlace, onPlaceOrder, activeMapId }: {
  groups: Group[];
  onPlace: (gId: string, x: number, y: number, mapId: string) => void;
  onPlaceOrder: (gId: string, x: number, y: number, mapId: string) => void;
  activeMapId: string;
}) {
  // armed: null | { gId, mode: "token" | "order" }
  const [armed, setArmed] = useState<{ gId: string; mode: "token" | "order" } | null>(null);
  const tactical = groups.filter((g) => g.id !== "unassigned" && !g.isSpawn);

  const armedRef = useRef(armed);
  useEffect(() => { armedRef.current = armed; }, [armed]);
  const skipNextClick = useRef(false);

  useEffect(() => {
    function handler(ev: MouseEvent) {
      if (skipNextClick.current) { skipNextClick.current = false; return; }
      const el = document.getElementById("map-img");
      if (!el || !armedRef.current) return;
      const rect = el.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        if (armedRef.current.mode === "token") onPlace(armedRef.current.gId, x, y, activeMapId);
        else onPlaceOrder(armedRef.current.gId, x, y, activeMapId);
        setArmed(null);
      }
    }
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [onPlace, onPlaceOrder, activeMapId]);

  const isArmed = (gId: string, mode: "token" | "order") =>
    armed?.gId === gId && armed?.mode === mode;
  const anyArmed = armed !== null;

  return (
    <div>
      <div className="text-xs text-gray-500 mb-2">Karte: <span className="text-blue-400">{activeMapId}</span></div>
      {tactical.map((g) => {
              return (
        <div key={g.id} className="flex gap-1 mb-1">
          {/* Token-Button */}
          <button
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
              isArmed(g.id, "token") ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"
            }`}
            onClick={(e) => { e.stopPropagation(); skipNextClick.current = true; setArmed(isArmed(g.id, "token") ? null : { gId: g.id, mode: "token" }); }}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: groupColor(g) }} />
            {isArmed(g.id, "token") ? "▶ Klicke…" : g.label}
          </button>
          {/* Auftrags-Button */}
          <button
            title={`Auftrag für ${g.label} setzen`}
            className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors flex items-center gap-1 ${
              isArmed(g.id, "order") ? "bg-orange-600 border-orange-500 text-white" : "bg-gray-800 border-gray-600 text-orange-400 hover:bg-gray-700 hover:border-orange-600"
            }`}
            onClick={(e) => { e.stopPropagation(); skipNextClick.current = true; setArmed(isArmed(g.id, "order") ? null : { gId: g.id, mode: "order" }); }}>
            {isArmed(g.id, "order") ? "▶ Klicke…" : "⚑"}
          </button>
        </div>
        );
      })}
      {anyArmed && (
        <button className="w-full rounded-lg border border-red-800 px-2 py-1.5 text-xs bg-red-950 text-red-400"
          onClick={(e) => { e.stopPropagation(); setArmed(null); }}>Abbrechen</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DRAWING TOOLBAR
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// HELP TIP – kleines ? mit Hover-Tooltip
// ─────────────────────────────────────────────────────────────

function HelpTip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center">
      <button
        className="w-4 h-4 rounded-full bg-gray-700 border border-gray-500 text-gray-400 text-xs flex items-center justify-center hover:bg-gray-600 hover:text-white flex-shrink-0 leading-none"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        title={text}
      >?</button>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// ZOOM PANEL  (verschiebbares Fenster für Zoom-Steuerung)
// ─────────────────────────────────────────────────────────────

function DrawingToolbar({
  tool, setTool, color, setColor, width, setWidth, canDraw,
  onUndo, onClear,
}: {
  tool: DrawTool; setTool: (t: DrawTool) => void;
  color: string; setColor: (c: string) => void;
  width: number; setWidth: (w: number) => void;
  canDraw: boolean; onUndo: () => void; onClear: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  if (!canDraw) return null;

  const tools: { id: DrawTool; icon: string; title: string }[] = [
    { id: "pointer",          icon: "↖",  title: "Zeiger (normal)" },
    { id: "pen",              icon: "✏",  title: "Freihand zeichnen" },
    { id: "line",             icon: "╱",  title: "Linie ziehen" },
    { id: "eraser",           icon: "⌫",  title: "Radiergummi" },
    { id: "text",             icon: "T",   title: "Text einfügen" },
    { id: "move",             icon: "✥",  title: "Element verschieben" },
  ];
  const markerTools: { id: DrawTool; icon: string; title: string; label: string }[] = [
    { id: "marker_infantry", icon: "✖", title: "Feindmarker: Infantrie", label: "Inf" },
    { id: "marker_ground",   icon: "▼", title: "Feindmarker: Bodenfahrzeug", label: "Bdn" },
    { id: "marker_air",      icon: "✈", title: "Feindmarker: Luft", label: "Luft" },
  ];

  return (
    <div
      className="select-none"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-300">Werkzeuge</span>
        <HelpTip text={"Zeichenwerkzeuge:\n↖ Zeiger – normal bewegen\n✏ Freihand – Linie zeichnen\n╱ Linie – gerade Linie\n⌫ Radierer – Element löschen\nT Text – Text platzieren\n✥ Verschieben – Element anfassen & ziehen\nFeindmarker: bleibt sichtbar, bis er manuell gelöscht wird"} />
      </div>

      <div className="flex flex-col gap-2 p-2">
        {/* Tools */}
        <div className="flex gap-1 flex-wrap">
          {tools.map((t) => (
            <button key={t.id} title={t.title} onClick={() => setTool(t.id)}
              className={`w-8 h-8 rounded-lg text-sm font-bold border transition-colors ${
                tool === t.id ? "bg-blue-600 border-blue-400 text-white" : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"
              }`}>
              {t.icon}
            </button>
          ))}
        </div>

        {/* Farben */}
        <div className="flex gap-1 flex-wrap">
          {DRAW_COLORS.map((c) => (
            <button key={c} title={c} onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                color === c ? "border-white scale-125" : "border-transparent"
              }`}
              style={{ backgroundColor: c }} />
          ))}
        </div>

        {/* Strichstärke */}
        <div className="flex gap-1 items-center">
          {DRAW_WIDTHS.map((w) => (
            <button key={w} title={`${w}px`} onClick={() => setWidth(w)}
              className={`rounded border flex items-center justify-center transition-colors ${
                width === w ? "border-blue-400 bg-blue-900" : "border-gray-600 bg-gray-800 hover:bg-gray-700"
              }`}
              style={{ width: 28, height: 28 }}>
              <div className="rounded-full bg-white" style={{ width: Math.min(w * 1.5, 20), height: Math.min(w * 1.5, 20) }} />
            </button>
          ))}
        </div>

        {/* Feindmarker */}
        <div className="border-t border-gray-700 pt-1.5">
          <div className="text-xs text-gray-500 mb-1">Feind ⚠ (dauerhaft)</div>
          <div className="flex gap-1">
            {markerTools.map((m) => (
              <button key={m.id} title={m.title} onClick={() => setTool(m.id)}
                className={`flex-1 h-8 rounded-lg text-xs font-bold border transition-colors ${
                  tool === m.id
                    ? "bg-red-700 border-red-500 text-white"
                    : "bg-gray-800 border-gray-600 text-red-400 hover:bg-gray-700"
                }`}>
                <div className="flex flex-col items-center leading-tight">
                  <span>{m.icon}</span>
                  <span className="text-[9px]">{m.label}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Undo / Clear */}
        <div className="flex gap-1">
          <button title="Rückgängig (letzter Strich)" onClick={onUndo}
            className="flex-1 h-7 rounded-lg text-xs border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700">
            ↩ Undo
          </button>
          {!confirmClear && (
            <button title="Alles löschen (diese Ebene)" onClick={() => setConfirmClear(true)}
              className="flex-1 h-7 rounded-lg text-xs border border-red-900 bg-red-950 text-red-400 hover:bg-red-900">
              🗑 Alles
            </button>
          )}
          {confirmClear && (
            <div className="flex gap-1 flex-1">
              <button className="flex-1 h-7 rounded-lg text-xs border border-red-700 bg-red-900 text-red-300 hover:bg-red-700 font-bold"
                onClick={() => { onClear(); setConfirmClear(false); }}>✓ Ja</button>
              <button className="flex-1 h-7 rounded-lg text-xs border border-gray-600 text-gray-400 hover:bg-gray-700"
                onClick={() => setConfirmClear(false)}>✕</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DRAWING LAYER  (SVG über dem Kartenbild, unter Tokens)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// DRAWING LAYER  – Canvas-basiert, sitzt direkt über dem Kartenbild
// Koordinaten: 0–1 relativ zur tatsächlichen Bildgröße (getBoundingClientRect)
// ─────────────────────────────────────────────────────────────

function DrawingLayer({
  elements, tool, color, strokeWidth, canDraw, showGrid,
  onAddElement, onRemoveElement, onUpdateElement, onResetTool,
}: {
  elements: DrawElement[];
  tool: DrawTool; color: string; strokeWidth: number;
  canDraw: boolean; showGrid: boolean;
  onAddElement: (el: DrawElement) => void;
  onRemoveElement: (id: string) => void;
  onUpdateElement: (el: DrawElement) => void;
  onResetTool?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const [mouseCoord, setMouseCoord] = useState<string | null>(null);
  const [mousePixel, setMousePixel] = useState<{ x: number; y: number } | null>(null);
  const pathPoints = useRef<{ x: number; y: number }[]>([]);
  const lineStart = useRef<{ x: number; y: number } | null>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const shiftHeld = useRef(false);

  // Move tool state
  const [movingEl, setMovingEl] = useState<{ el: DrawElement; startRel: { x: number; y: number }; origEl: DrawElement } | null>(null);
  const movingPreviewRef = useRef<DrawElement | null>(null);

  // Text
  const [textInput, setTextInput] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [textVal, setTextVal] = useState("");
  const textRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (textInput && textRef.current) textRef.current.focus(); }, [textInput]);
  const hasEnemyMarkers = elements.some((element) => element.type === "marker");
  const [markerNow, setMarkerNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasEnemyMarkers) return;
    const timer = window.setInterval(() => setMarkerNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [hasEnemyMarkers]);

  function getImgRect(): DOMRect | null {
    // Canvas ist deckungsgleich mit map-img – wir nehmen das Canvas-Rect
    // damit Koordinaten korrekt sind wenn Canvas innerhalb der transform-Div sitzt
    return canvasRef.current ? canvasRef.current.getBoundingClientRect() : null;
  }

  function toRel(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = getImgRect();
    if (!rect) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top)  / rect.height)),
    };
  }

  function redraw(extraStroke?: { points: { x: number; y: number }[] } | null, extraLine?: { x1: number; y1: number; x2: number; y2: number } | null) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Gitternetz
    if (showGrid) {
      const GCOLS = 30, GROWS = 20;
      function gridColLabel(i: number): string {
        if (i < 26) return String.fromCharCode(65 + i);
        return "A" + String.fromCharCode(65 + (i - 26));
      }
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.font = "bold 8px Arial";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.textBaseline = "top";
      for (let c = 0; c <= GCOLS; c++) {
        const px = (c / GCOLS) * W;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
        if (c < GCOLS) ctx.fillText(gridColLabel(c), px + 2, 3);
      }
      for (let r = 0; r <= GROWS; r++) {
        const py = (r / GROWS) * H;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
        if (r < GROWS) ctx.fillText(String(r + 1), 3, py + 3);
      }
    }

    // Gespeicherte Elemente rendern (mit optionalem Move-Preview)
    const preview = movingPreviewRef.current;
    const renderEls = preview ? elements.map((el) => el.id === preview.id ? preview : el) : elements;
    for (const el of renderEls) {
      if (el.type === "path" && el.d) {
        // Parse SVG-Path-Punkte aus "M x,y L x,y L x,y ..."
        const pts = el.d.replace(/M|L/g, "").trim().split(" ").map((s: string) => {
          const [x, y] = s.split(",").map(Number);
          return { x: x * W, y: y * H };
        }).filter((p: { x: number; y: number }) => !isNaN(p.x) && !isNaN(p.y));
        if (pts.length < 1) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.width;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.stroke();
      } else if (el.type === "line") {
        ctx.beginPath();
        ctx.moveTo(el.x1 * W, el.y1 * H);
        ctx.lineTo(el.x2 * W, el.y2 * H);
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.width;
        ctx.lineCap = "round";
        ctx.stroke();
      } else if (el.type === "text") {
        ctx.font = `bold ${el.size}px Arial`;
        ctx.fillStyle = el.color;
        ctx.textBaseline = "hanging";
        ctx.fillText(el.text, el.x * W, el.y * H);
      } else if (el.type === "marker") {
        const marker = normalizeEnemyMarker(el);
        if (!marker) continue;
        const cx = marker.x * W;
        const cy = marker.y * H;
        const sz = 18; // Radius des Symbols in px
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = marker.color;
        ctx.fillStyle = marker.color;
        ctx.lineWidth = 2.5;
        ctx.font = `bold ${sz}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (marker.kind === "infantry") {
          // Infantrie: Kreuz (✖) in Kreis
          ctx.beginPath();
          ctx.arc(cx, cy, sz * 0.85, 0, Math.PI * 2);
          ctx.stroke();
          // X innen
          const d = sz * 0.5;
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d); ctx.stroke();
        } else if (marker.kind === "ground") {
          // Boden: gefülltes Dreieck (▼)
          ctx.beginPath();
          ctx.moveTo(cx, cy + sz * 0.9);
          ctx.lineTo(cx - sz * 0.85, cy - sz * 0.55);
          ctx.lineTo(cx + sz * 0.85, cy - sz * 0.55);
          ctx.closePath();
          ctx.stroke();
          // Querbalken oben
          ctx.beginPath(); ctx.moveTo(cx - sz * 0.85, cy - sz * 0.55); ctx.lineTo(cx + sz * 0.85, cy - sz * 0.55); ctx.stroke();
        } else if (marker.kind === "air") {
          // Luft: Dreieck (^) mit Flügeln (NATO-Luftzeichen)
          ctx.beginPath();
          ctx.moveTo(cx, cy - sz * 0.9);
          ctx.lineTo(cx - sz * 0.85, cy + sz * 0.55);
          ctx.lineTo(cx + sz * 0.85, cy + sz * 0.55);
          ctx.closePath();
          ctx.stroke();
          // Querbalken unten
          ctx.beginPath(); ctx.moveTo(cx - sz * 0.85, cy + sz * 0.55); ctx.lineTo(cx + sz * 0.85, cy + sz * 0.55); ctx.stroke();
        }

        // Label + Timestamp unten
        ctx.globalAlpha = 0.9;
        ctx.font = `bold 9px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const kindLabel = marker.kind === "infantry" ? "INF" : marker.kind === "ground" ? "BDN" : "LUFT";
        const timeLabel = enemyMarkerAgeLabel(marker.createdAt, markerNow);
        ctx.fillText(`${kindLabel} ${timeLabel}`, cx, cy + sz + 2);
        ctx.restore();
      }
    }

    // Live-Strich
    if (extraStroke && extraStroke.points.length > 1) {
      const pts = extraStroke.points;
      ctx.beginPath();
      ctx.moveTo(pts[0].x * W, pts[0].y * H);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * H);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.stroke();
    }

    // Live-Linie
    if (extraLine) {
      ctx.beginPath();
      ctx.moveTo(extraLine.x1 * W, extraLine.y1 * H);
      ctx.lineTo(extraLine.x2 * W, extraLine.y2 * H);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  // Canvas neu zeichnen wenn sich Elemente, Grid oder Tool ändern
  useEffect(() => { redraw(); }, [elements, showGrid, tool, color, strokeWidth, movingEl, markerNow]);

  // Canvas-Größe an Bild anpassen – wir verwenden offsetWidth/offsetHeight
  // (die CSS-Größe des Elements VOR dem äußeren CSS-transform/scale),
  // damit canvas.width/height in natürlichen Pixeln bleibt und nicht zoom-skaliert wird.
  function syncCanvasSize() {
    const canvas = canvasRef.current;
    const img = document.getElementById("map-img") as HTMLImageElement | null;
    if (!canvas || !img) return;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width  = w;
      canvas.height = h;
      redraw();
    }
  }

  // ResizeObserver: Canvas neu skalieren wenn Bild sich verändert (Fenstergröße)
  useEffect(() => {
    const img = document.getElementById("map-img");
    if (!img) return;
    const ro = new ResizeObserver(() => { syncCanvasSize(); });
    ro.observe(img);
    syncCanvasSize();
    return () => ro.disconnect();
  }, [elements, showGrid, markerNow]);

  function onPointerDown(e: React.PointerEvent) {
    if (!canDraw || tool === "pointer") return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const p = toRel(e.clientX, e.clientY);
    if (!p) return;

    if (tool === "text") {
      const rect = getImgRect()!;
      setTextInput({ x: p.x, y: p.y, px: e.clientX - rect.left, py: e.clientY - rect.top });
      setTextVal("");
      return;
    }

    shiftHeld.current = e.shiftKey;
    if (tool === "marker_infantry" || tool === "marker_ground" || tool === "marker_air") {
      const kind = tool.replace("marker_", "") as "infantry" | "ground" | "air";
      onAddElement({ id: uid(), type: "marker", kind, x: p.x, y: p.y, color: "#ef4444", opacity: 1.0, createdAt: currentTimestamp() });
      if (!e.shiftKey) onResetTool?.();
      return;
    }

    if (tool === "move") {
      const found = hitTest(p);
      if (found) {
        setMovingEl({ el: found, startRel: p, origEl: found });
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }

    if (tool === "eraser") {
      eraseAt(p); return;
    }

    if (tool === "pen") {
      drawing.current = true;
      pathPoints.current = [p];
      return;
    }

    if (tool === "line") {
      lineStart.current = p;
      return;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    // Grid-Koordinaten immer tracken (unabhängig von canDraw)
    if (showGrid) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        const ci = Math.min(29, Math.floor(px * 30));
        const col = ci < 26 ? String.fromCharCode(65 + ci) : "A" + String.fromCharCode(65 + (ci - 26));
        const row = Math.min(20, Math.floor(py * 20) + 1);
        setMouseCoord(`${col}${row}`);
        setMousePixel({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    } else {
      if (mouseCoord) { setMouseCoord(null); setMousePixel(null); }
    }

    if (!canDraw) return;
    const p = toRel(e.clientX, e.clientY);
    if (!p) return;
    lastPos.current = p;
    // Koordinaten-Label für Grid-Anzeige
    if (showGrid) {
      const ci = Math.min(29, Math.floor(p.x * 30));
      const col = ci < 26 ? String.fromCharCode(65 + ci) : "A" + String.fromCharCode(65 + (ci - 26));
      const row = Math.min(20, Math.floor(p.y * 20) + 1);
      setMouseCoord(`${col}${row}`);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setMousePixel({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else {
      setMouseCoord(null);
      setMousePixel(null);
    }

    if (tool === "eraser" && e.buttons === 1) { eraseAt(p); return; }

    if (tool === "move" && movingEl && e.buttons === 1) {
      const dx = p.x - movingEl.startRel.x;
      const dy = p.y - movingEl.startRel.y;
      const moved = applyDelta(movingEl.origEl, dx, dy);
      setMovingEl((prev) => prev ? { ...prev, el: moved } : null);
      movingPreviewRef.current = moved;
      redraw();
      return;
    }

    if (tool === "pen" && drawing.current) {
      pathPoints.current.push(p);
      redraw({ points: pathPoints.current }, null);
      return;
    }

    if (tool === "line" && lineStart.current && e.buttons === 1) {
      redraw(null, { x1: lineStart.current.x, y1: lineStart.current.y, x2: p.x, y2: p.y });
      return;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!canDraw) return;
    const p = toRel(e.clientX, e.clientY) ?? lastPos.current;

    if (tool === "pen" && drawing.current) {
      drawing.current = false;
      const pts = pathPoints.current;
      if (pts.length > 1) {
        const d = "M" + pts.map((pt) => `${pt.x.toFixed(4)},${pt.y.toFixed(4)}`).join(" L");
        onAddElement({ id: uid(), type: "path", d, color, width: strokeWidth });
      }
      pathPoints.current = [];
      redraw();
      if (!shiftHeld.current) onResetTool?.();
      return;
    }

    if (tool === "line" && lineStart.current && p) {
      onAddElement({ id: uid(), type: "line",
        x1: lineStart.current.x, y1: lineStart.current.y, x2: p.x, y2: p.y,
        color, width: strokeWidth });
      lineStart.current = null;
      redraw();
      if (!shiftHeld.current) onResetTool?.();
      return;
    }

    if (tool === "move" && movingEl) {
      const dx = (p?.x ?? movingEl.startRel.x) - movingEl.startRel.x;
      const dy = (p?.y ?? movingEl.startRel.y) - movingEl.startRel.y;
      const committed = applyDelta(movingEl.origEl, dx, dy);
      movingPreviewRef.current = null;
      setMovingEl(null);
      onUpdateElement(committed);
      if (!shiftHeld.current) onResetTool?.();
      return;
    }
  }

  // Hit-test: find element at relative coords p
  function hitTest(p: { x: number; y: number }): DrawElement | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const W = canvas.width, H = canvas.height;
    const hitPx = Math.max(16, 12);
    const tx = hitPx / W, ty = hitPx / H;

    // Reverse iterate so topmost (last drawn) wins
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.type === "marker") {
        if (Math.abs(el.x - p.x) < tx * 1.5 && Math.abs(el.y - p.y) < ty * 1.5) return el;
      } else if (el.type === "text") {
        const estW = (el.text.length * el.size * 0.6) / W;
        const estH = (el.size * 1.4) / H;
        if (p.x >= el.x - tx && p.x <= el.x + estW + tx && p.y >= el.y - ty && p.y <= el.y + estH + ty) return el;
      } else if (el.type === "line") {
        const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
        if (Math.abs(mx - p.x) < tx * 2 && Math.abs(my - p.y) < ty * 2) return el;
      } else if (el.type === "path") {
        const pts = el.d.replace(/M|L/g, "").trim().split(" ").map((s: string) => {
          const [x, y] = s.split(",").map(Number); return { x, y };
        });
        if (pts.some((pt: { x: number; y: number }) => Math.abs(pt.x - p.x) < tx && Math.abs(pt.y - p.y) < ty)) return el;
      }
    }
    return null;
  }

  // Apply a delta (dx, dy) to an element, returning a moved copy
  function applyDelta(el: DrawElement, dx: number, dy: number): DrawElement {
    if (el.type === "marker" || el.type === "text") return { ...el, x: el.x + dx, y: el.y + dy };
    if (el.type === "line") return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
    if (el.type === "path") {
      // Shift all path points
      const newD = el.d.replace(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g, (_: string, sx: string, sy: string) => {
        return `${(parseFloat(sx) + dx).toFixed(4)},${(parseFloat(sy) + dy).toFixed(4)}`;
      });
      return { ...el, d: newD };
    }
    return el;
  }

  function eraseAt(p: { x: number; y: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    // Schwellenwert in Pixel, dann in relative Koordinaten umrechnen
    const threshPx = Math.max(strokeWidth * 2, 12);
    const tx = threshPx / W, ty = threshPx / H;
    for (const el of elements) {
      if (el.type === "path") {
        const pts = el.d.replace(/M|L/g, "").trim().split(" ").map((s: string) => {
          const [x, y] = s.split(",").map(Number);
          return { x, y };
        });
        if (pts.some((pt: { x: number; y: number }) => Math.abs(pt.x - p.x) < tx && Math.abs(pt.y - p.y) < ty)) {
          onRemoveElement(el.id); return;
        }
      } else if (el.type === "line") {
        const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
        if (Math.abs(mx - p.x) < tx && Math.abs(my - p.y) < ty) { onRemoveElement(el.id); return; }
      } else if (el.type === "text") {
        // Text wird ab (el.x, el.y) nach rechts+unten gerendert (textBaseline hanging)
        // Wir schätzen Breite grob via Zeichenzahl, Höhe via el.size
        const estW = (el.text.length * el.size * 0.6) / W;
        const estH = (el.size * 1.4) / H;
        const inX = p.x >= el.x - tx && p.x <= el.x + estW + tx;
        const inY = p.y >= el.y - ty && p.y <= el.y + estH + ty;
        if (inX && inY) { onRemoveElement(el.id); return; }
      } else if (el.type === "marker") {
        // Marker: Klick-Radius ~24px um Mittelpunkt
        const mThreshPx = Math.max(24, threshPx);
        const mtx = mThreshPx / W, mty = mThreshPx / H;
        if (Math.abs(el.x - p.x) < mtx && Math.abs(el.y - p.y) < mty) {
          onRemoveElement(el.id); return;
        }
      }
    }
  }

  function commitText() {
    if (textVal.trim() && textInput) {
      onAddElement({ id: uid(), type: "text",
        x: textInput.x, y: textInput.y,
        text: textVal.trim(), color, size: strokeWidth * 4 + 10 });
    }
    setTextInput(null); setTextVal("");
  }

  const cursorStyle =
    tool === "pointer" ? "default" :
    tool === "eraser"  ? "cell" :
    tool === "text"    ? "text" :
    tool === "move"    ? (movingEl ? "grabbing" : "grab") :
    tool.startsWith("marker_") ? "crosshair" : "crosshair";

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ zIndex: 20, pointerEvents: tool === "pointer" ? "none" : "auto" }}
      onMouseMove={showGrid ? (e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        const ci = Math.min(29, Math.floor(px * 30));
        const col = ci < 26 ? String.fromCharCode(65 + ci) : "A" + String.fromCharCode(65 + (ci - 26));
        const row = Math.min(20, Math.floor(py * 20) + 1);
        setMouseCoord(`${col}${row}`);
        setMousePixel({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      } : undefined}
      onMouseLeave={showGrid ? () => { setMouseCoord(null); setMousePixel(null); } : undefined}
    >
      {/* Grid-Tracking-Div: über dem Canvas, aber nur für mousemove – kein click-blocking */}
      {showGrid && (
        <div className="absolute inset-0" style={{ zIndex: 22, pointerEvents: "none" }}
          ref={(el) => {
            if (!el) return;
            // Nutze native addEventListener mit passive:true um den Cursor nicht zu blockieren
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: "100%", height: "100%",
          cursor: cursorStyle,
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { setMouseCoord(null); setMousePixel(null); }}
      />

      {/* Grid-Koordinaten-Anzeige am Mauszeiger */}
      {showGrid && mouseCoord && mousePixel && (
        <div className="absolute z-30 pointer-events-none select-none"
          style={{ left: mousePixel.x + 14, top: mousePixel.y - 20 }}>
          <span className="bg-black bg-opacity-50 text-white text-xs font-mono px-1.5 py-0.5 rounded border border-white border-opacity-20">
            {mouseCoord}
          </span>
        </div>
      )}

      {/* Text-Eingabefeld – positioniert relativ zum Bild */}
      {textInput && (
        <div
          className="absolute z-50 pointer-events-auto"
          style={{ left: textInput.px, top: textInput.py }}
        >
          <input
            ref={textRef}
            className="bg-gray-900 bg-opacity-90 border border-blue-500 text-white text-sm px-2 py-1 rounded shadow-lg outline-none min-w-[140px]"
            style={{ color }}
            value={textVal}
            onChange={(e) => setTextVal(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") { setTextInput(null); setTextVal(""); }
            }}
            onBlur={commitText}
            placeholder="Text… Enter bestätigt"
          />
        </div>
      )}
    </div>
  );
}

// ZOOMABLE MAP
// BUGFIX: Mausrad = nur Scrollen/Panning, kein Zoom. Zoom nur über Buttons.
// ─────────────────────────────────────────────────────────────
// ZOOM PANEL – verschiebbares Fenster für Zoom-Steuerung
// ─────────────────────────────────────────────────────────────

function ZoomPanel({ x, y, onMove, onZoomIn, onZoomOut, onReset, scale }: {
  x: number; y: number; onMove: (x: number, y: number) => void;
  onZoomIn: () => void; onZoomOut: () => void; onReset: () => void;
  scale: number;
}) {
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  function onHandleDown(e: React.PointerEvent) {
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: x, py: y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  }
  function onHandleMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    onMove(
      Math.max(0, dragStart.current.px + e.clientX - dragStart.current.mx),
      Math.max(0, dragStart.current.py + e.clientY - dragStart.current.my),
    );
  }
  function onHandleUp() { dragging.current = false; }

  return (
    <div
      className="absolute z-30 bg-gray-900 bg-opacity-95 border border-gray-700 rounded-2xl shadow-xl select-none overflow-hidden"
      style={{ left: x, top: y, minWidth: 90 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 bg-gray-800 cursor-move"
        onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
      >
        <span className="text-gray-500 text-xs">⠿</span>
        <span className="text-xs font-semibold text-gray-300">🔍</span>
        <span className="text-xs text-gray-500 ml-auto">{Math.round(scale * 100)}%</span>
      </div>
      <div className="flex flex-col gap-1 p-2">
        <button onClick={onZoomIn}  onPointerDown={(e) => e.stopPropagation()} className="w-full h-8 rounded-lg text-sm font-bold border border-gray-600 bg-gray-800 text-white hover:bg-gray-700">＋</button>
        <button onClick={onZoomOut} onPointerDown={(e) => e.stopPropagation()} className="w-full h-8 rounded-lg text-sm font-bold border border-gray-600 bg-gray-800 text-white hover:bg-gray-700">－</button>
        <button onClick={onReset}   onPointerDown={(e) => e.stopPropagation()} className="w-full h-8 rounded-lg text-xs border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700">⊙ Reset</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function ZoomableMap({ imageSrc, tokens, groups, board, playersById, aliveState, groupRoles,
  onMoveTokenLocal, onCommitToken, canWriteTokens, isAdmin: isAdminProp, markers, onOpenMarker,
  onCommitMarker, activeMapId, onRemoveToken, onMoveTokenUp, getActiveGroupsForMarker,
  orderMarkers, onMoveOrderMarkerLocal, onCommitOrderMarker, onRemoveOrderMarker,
  onResetDrawTool,
  drawElements, drawTool, drawColor, drawWidth, canDraw, onAddDrawElement, onRemoveDrawElement, onUpdateDrawElement,
  showGrid, onScaleChange,
}: {
  imageSrc: string; tokens: Token[]; groups: Group[]; board: BoardState;
  playersById: Record<string, Player>; aliveState: PlayerAliveState; groupRoles: GroupRoles;
  onMoveTokenLocal: (gId: string, x: number, y: number, mapId: string) => void;
  onCommitToken: (gId: string, x: number, y: number, mapId: string) => void;
  canWriteTokens: boolean; isAdmin: boolean;
  markers: Array<{ id: string; label: string; x: number; y: number; isPOI?: boolean }>;
  onOpenMarker: (id: string) => void; onCommitMarker: (id: string, x: number, y: number) => void;
  activeMapId: string; onRemoveToken: (gId: string, mapId: string) => void;
  onMoveTokenUp?: (gId: string, fromMapId: string) => void;
  getActiveGroupsForMarker?: (markerId: string) => { groupId: string; color: string; label: string }[];
  orderMarkers: OrderMarker[];
  onMoveOrderMarkerLocal: (gId: string, x: number, y: number, mapId: string) => void;
  onCommitOrderMarker: (gId: string, x: number, y: number, mapId: string) => void;
  onResetDrawTool?: () => void;
  onRemoveOrderMarker: (gId: string, mapId: string) => void;
  drawElements: DrawElement[]; drawTool: DrawTool; drawColor: string; drawWidth: number;
  canDraw: boolean;
  onAddDrawElement: (el: DrawElement) => void;
  onRemoveDrawElement: (id: string) => void;
  onUpdateDrawElement: (el: DrawElement) => void;
  showGrid: boolean;
  onScaleChange: (scale: number, setScale: (fn: (s: number) => number) => void, resetView: () => void) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 }); // für lag-freies Panning via DOM

  function resetView() {
    setScale(1);
    offsetRef.current = { x: 0, y: 0 };
    setOffset({ x: 0, y: 0 });
    if (transformDivRef.current) transformDivRef.current.style.transform = `translate(0px,0px) scale(1)`;
  }

  // expose scale control to parent (for ZoomPanel)
  useEffect(() => {
    onScaleChange(scale, setScale, resetView);
  }, [scale, onScaleChange]);
  const [tokenDrag, setTokenDrag] = useState<string | null>(null);
  const [markerDrag, setMarkerDrag] = useState<string | null>(null);
  const [openGroupMenu, setOpenGroupMenu] = useState<string | null>(null); // markerId
  const [panning, setPanning] = useState(false);
  const [gridCoord, setGridCoord] = useState<string | null>(null);
  const [gridPixel, setGridPixel] = useState<{ x: number; y: number } | null>(null);
  // Bildseitenverhältnis für korrektes Layout (kein object-contain Letterboxing)
  const [imgAspect, setImgAspect] = useState<number | null>(null);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const lastTokenPos = useRef<{ x: number; y: number } | null>(null);
  const lastMarkerPos = useRef<{ x: number; y: number } | null>(null);
  const [hoveredToken, setHoveredToken] = useState<string | null>(null);
  const mapRootRef = useRef<HTMLDivElement>(null);
  const draggingTokenEl  = useRef<HTMLElement | null>(null); // DOM-Ref für lag-freies Token-Drag
  const draggingMarkerEl = useRef<HTMLElement | null>(null); // DOM-Ref für lag-freies Marker-Drag
  const isDraggingAny    = useRef(false); // sync flag – verhindert Pan-Start wenn Token/Marker gezogen
  // Tatsächlicher Bildbereich innerhalb des object-contain Containers (Letterbox-Offset)
  const [imgOffset, setImgOffset] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const transformDivRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // imgOffset: tatsächlicher Bildbereich innerhalb des object-contain Containers
    // Wichtig: relativ zur transform-Div (nicht zum Root), damit Zoom keine Auswirkung hat
    function updateImgOffset() {
      const img = document.getElementById("map-img") as HTMLImageElement | null;
      const transformDiv = transformDivRef.current;
      if (!img || !transformDiv || !img.naturalWidth || !img.naturalHeight) return;
      // clientWidth/Height der transform-Div ist unabhängig von scale()
      const cw = transformDiv.clientWidth;
      const ch = transformDiv.clientHeight;
      const iAspect = img.naturalWidth / img.naturalHeight;
      const cAspect = cw / ch;
      let iw: number, ih: number;
      if (iAspect > cAspect) { iw = cw; ih = cw / iAspect; }
      else { ih = ch; iw = ch * iAspect; }
      setImgOffset({ left: (cw - iw) / 2, top: (ch - ih) / 2, width: iw, height: ih });
    }
    const ro = new ResizeObserver(updateImgOffset);
    if (mapRootRef.current) ro.observe(mapRootRef.current);
    updateImgOffset();
    return () => ro.disconnect();
  }, [imgAspect]);

  // Nicht-passiver Wheel-Listener → verhindert Browser-Scroll, Mausrad = Zoom
  useEffect(() => {
    const el = mapRootRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.91;
      setScale((s) => {
        const next = Math.max(0.3, Math.min(6, s * zoomFactor));
        if (next <= 1) { offsetRef.current = { x: 0, y: 0 }; setOffset({ x: 0, y: 0 }); } // reset pan wenn rausgezoomt
        return next;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);
  // Double-click tracking for markers (stored outside render map)
  const markerClickCount = useRef<Record<string, number>>({});
  const markerClickTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function getMapCoords(e: React.PointerEvent | PointerEvent) {
    const container = mapRootRef.current;
    const io = imgOffset;
    if (!container) return null;

    const cr = container.getBoundingClientRect();
    // Inverse der CSS-Transform: translate(offset.x, offset.y) scale(scale) mit origin=center
    // 1. Mausposition relativ zur Mitte des Containers
    const mx = e.clientX - (cr.left + cr.width  / 2);
    const my = e.clientY - (cr.top  + cr.height / 2);
    // 2. Rückgängig: translate → scale
    const lx = (mx - offset.x) / scale;  // logisch, relativ zur Mitte
    const ly = (my - offset.y) / scale;
    // 3. Relativ zur oberen linken Ecke des transform-Div
    const px = lx + cr.width  / 2;  // px in transform-Div-Koordinaten
    const py = ly + cr.height / 2;

    // 4. Relativ zum imgOffset-Bereich (wo das Bild tatsächlich sitzt)
    const left = io ? io.left   : 0;
    const top  = io ? io.top    : 0;
    const w    = io ? io.width  : cr.width;
    const h    = io ? io.height : cr.height;

    return {
      x: Math.max(0, Math.min(1, (px - left) / w)),
      y: Math.max(0, Math.min(1, (py - top)  / h)),
    };
  }

  // Mausrad-Zoom: handled via nicht-passivem native listener auf mapRootRef (siehe useEffect oben)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function onWheel(_e: React.WheelEvent) { /* handled natively */ }

  function onBgDown(e: React.PointerEvent) {
    if (isDraggingAny.current || tokenDrag || markerDrag || orderMarkerDrag) return;
    if (scale <= 1) return; // Panning nur wenn reingezoomt
    setPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onBgMove(e: React.PointerEvent) {
    if (panning && !tokenDrag && !markerDrag && !orderMarkerDrag) {
      const container = mapRootRef.current;
      if (container && transformDivRef.current) {
        const maxX = (scale - 1) * container.clientWidth  / 2;
        const maxY = (scale - 1) * container.clientHeight / 2;
        const nx = Math.max(-maxX, Math.min(maxX, panStart.current.ox + e.clientX - panStart.current.x));
        const ny = Math.max(-maxY, Math.min(maxY, panStart.current.oy + e.clientY - panStart.current.y));
        offsetRef.current = { x: nx, y: ny };
        // Direkt per DOM – kein React re-render, kein Frame-Delay
        applyMapTransform(transformDivRef.current, nx, ny, scale);
      }
    }
    if (tokenDrag && canWriteTokens) {
      const c = getMapCoords(e);
      if (c) {
        lastTokenPos.current = c;
        // Direkt per DOM – kein React Re-Render während des Drags
        if (draggingTokenEl.current) {
          draggingTokenEl.current.style.left = `${c.x * 100}%`;
          draggingTokenEl.current.style.top  = `${c.y * 100}%`;
        }
      }
    }
    if (markerDrag) {
      const c = getMapCoords(e);
      if (c) {
        lastMarkerPos.current = c;
        if (draggingMarkerEl.current) {
          draggingMarkerEl.current.style.left = `${c.x * 100}%`;
          draggingMarkerEl.current.style.top  = `${c.y * 100}%`;
        }
      }
    }
    if (orderMarkerDrag && canWriteTokens) {
      const c = getMapCoords(e);
      if (c) { lastOrderMarkerPos.current = c; onMoveOrderMarkerLocal(orderMarkerDrag, c.x, c.y, activeMapId); }
    }
  }

  function onBgUp() {
    if (tokenDrag && lastTokenPos.current && canWriteTokens) {
      const [gId] = tokenDrag.split(":");
      const pos = lastTokenPos.current;
      // commitToken zuerst – liest noch die alte Position aus tokensRef für Op-Log
      onCommitToken(gId, pos.x, pos.y, activeMapId);
      // moveTokenLocal danach – updated tokensRef auf neue Position
      onMoveTokenLocal(gId, pos.x, pos.y, activeMapId);
    }
    draggingTokenEl.current = null;
    if (markerDrag && lastMarkerPos.current) onCommitMarker(markerDrag, lastMarkerPos.current.x, lastMarkerPos.current.y);
    draggingMarkerEl.current = null;
    if (orderMarkerDrag && lastOrderMarkerPos.current && canWriteTokens) {
      onCommitOrderMarker(orderMarkerDrag, lastOrderMarkerPos.current.x, lastOrderMarkerPos.current.y, activeMapId);
    }
    if (panning) setOffset(offsetRef.current); // sync nach Pan
    isDraggingAny.current = false;
    setPanning(false); setTokenDrag(null); lastTokenPos.current = null;
    setMarkerDrag(null); lastMarkerPos.current = null;
    setOrderMarkerDrag(null); lastOrderMarkerPos.current = null;
  }

  const visibleTokens = parseTokens(tokens).filter((t) => t.mapId === activeMapId);
  const visibleOrderMarkers = orderMarkers.filter((m) => m.mapId === activeMapId);
  const [orderMarkerDrag, setOrderMarkerDrag] = useState<string | null>(null);
  const lastOrderMarkerPos = useRef<{ x: number; y: number } | null>(null);
  const [hoveredOrderMarker, setHoveredOrderMarker] = useState<string | null>(null);
  const groupById = (gId: string) => groups.find((g) => g.id === gId);
  const groupCount = (gId: string) => (board.columns[gId] ?? []).filter((pid) => !!playersById[pid]).length;

  // Hover-Tooltip: Members, Leader, Deputy
  function buildTooltip(gId: string): React.ReactNode {
    const g = groupById(gId);
    if (!g) return null;
    const ids = board.columns[gId] ?? [];
    const gr = groupRoles[gId] ?? {};

    const sortedIds = [...ids].sort((a, b) => {
      const aIsLeader  = gr.leader  === a ? 0 : gr.deputy === a ? 1 : 2;
      const bIsLeader  = gr.leader  === b ? 0 : gr.deputy === b ? 1 : 2;
      return aIsLeader - bIsLeader;
    });

    return (
      <div className="text-left">
        <div className="font-bold text-sm mb-1 border-b border-gray-600 pb-1" style={{ color: groupColor(g) }}>{g.label}</div>
        {sortedIds.map((pid) => {
          const p = playersById[pid];
          if (!p) return null;
          const isL = gr.leader  === pid;
          const isD = gr.deputy  === pid;
          const isDead = aliveState[pid] === "dead";
          return (
            <div key={pid} className={`text-xs flex items-center gap-1 py-0.5 ${isDead ? "line-through text-gray-500" : "text-gray-200"}`}>
              {isL && <span className="text-yellow-400 text-xs">★★</span>}
              {isD && <span className="text-yellow-400 text-xs">★</span>}
              {!isL && !isD && <span className="w-4" />}
              {p.icon && <GroupIconDisplay icon={p.icon} size={12} />}
              {p.name}
              {isDead && <span className="text-red-400 ml-1">☠</span>}
            </div>
          );
        })}
        {ids.length === 0 && <div className="text-xs text-gray-500">leer</div>}
      </div>
    );
  }

  return (
    <div ref={mapRootRef} className="w-full h-full overflow-hidden relative"
      style={{ cursor: drawTool !== "pointer" && canDraw ? "crosshair" : scale > 1 ? (panning ? "grabbing" : "grab") : "default" }}
      onPointerDown={(e) => { if (drawTool !== "pointer" && canDraw && scale <= 1) return; onBgDown(e); }}
      onPointerMove={(e) => {
        // Grid-Koordinaten immer tracken
        if (showGrid) {
          const img = document.getElementById("map-img");
          if (img) {
            const r = img.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width;
            const py = (e.clientY - r.top) / r.height;
            if (px >= 0 && px <= 1 && py >= 0 && py <= 1) {
              const ci = Math.min(29, Math.floor(px * 30));
              const col = ci < 26 ? String.fromCharCode(65 + ci) : "A" + String.fromCharCode(65 + (ci - 26));
              const row = Math.min(20, Math.floor(py * 20) + 1);
              setGridCoord(`${col}${row}`);
              setGridPixel({ x: e.clientX, y: e.clientY });
            }
          }
        }
        if (drawTool !== "pointer" && canDraw && !tokenDrag && !markerDrag && !orderMarkerDrag) return; onBgMove(e);
      }}
      onPointerUp={() => { if (drawTool !== "pointer" && canDraw && !tokenDrag && !markerDrag && !orderMarkerDrag) return; onBgUp(); }}
      onPointerLeave={() => { setGridCoord(null); setGridPixel(null); }}>

      {/* Zoom-Steuerung ist jetzt im verschiebbaren ZoomPanel außerhalb */}

      {/* Grid-Koordinaten-Label am Mauszeiger */}
      {showGrid && gridCoord && gridPixel && (
        <div className="fixed z-50 pointer-events-none select-none"
          style={{ left: gridPixel.x + 14, top: gridPixel.y - 22 }}>
          <span className="bg-black bg-opacity-60 text-white text-xs font-mono px-1.5 py-0.5 rounded border border-white border-opacity-25">
            {gridCoord}
          </span>
        </div>
      )}

      <div ref={transformDivRef} style={{
        transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`,
        transformOrigin: "center center",
        transition: (tokenDrag || markerDrag || panning) ? "none" : "transform 0.1s",
        width: "100%", height: "100%", position: "relative",
      }}>
        <img id="map-img" src={imageSrc} alt="Map"
          className="w-full h-full object-contain block select-none"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setImgAspect(img.naturalWidth / img.naturalHeight);
            }
          }}
        />

        {/* Overlay-Div: sitzt exakt über dem Bildbereich (letterbox-korrigiert) */}
        <div style={{
          position: "absolute",
          left:   imgOffset ? imgOffset.left   : 0,
          top:    imgOffset ? imgOffset.top    : 0,
          width:  imgOffset ? imgOffset.width  : "100%",
          height: imgOffset ? imgOffset.height : "100%",
        }}>

        {/* Drawing Layer – innerhalb der transform-Div, bewegt/skaliert mit der Karte */}
        <DrawingLayer
          elements={drawElements}
          tool={drawTool}
          color={drawColor}
          strokeWidth={drawWidth}
          canDraw={canDraw}
          showGrid={showGrid}
          onAddElement={onAddDrawElement}
          onRemoveElement={onRemoveDrawElement}
          onUpdateElement={onUpdateDrawElement}
          onResetTool={onResetDrawTool}
        />

        {/* Altes SVG-Außenraster entfernt – Grid ist jetzt nur im Canvas */}

        {/* Marker – Doppelklick öffnet, Einfachklick / Drag verschiebt */}
        {/* markerClickCounters: id → count, stored outside map via closure */}
        {markers.map((m) => {
          const activeGroups = getActiveGroupsForMarker ? getActiveGroupsForMarker(m.id) : [];
          const showGroupMenu = openGroupMenu === m.id;
          return (
            <div key={m.id}
              className={`absolute z-10 flex flex-col items-center gap-0.5 ${isAdminProp ? "cursor-move" : "cursor-pointer"}`}
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: `translate(-50%,-100%) scale(${Math.min(1, 1/scale)})`, transformOrigin: "center bottom" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (isAdminProp) {
                  const el = e.currentTarget as HTMLElement;
                  el.setPointerCapture(e.pointerId);
                  draggingMarkerEl.current = el;
                  isDraggingAny.current = true;
                  setMarkerDrag(m.id); lastMarkerPos.current = null;
                }
              }}
              onPointerMove={(e) => { if (markerDrag === m.id) { e.stopPropagation(); onBgMove(e); } }}
              onPointerUp={(e) => { if (markerDrag === m.id) { e.stopPropagation(); onBgUp(); } }}
              onClick={(e) => {
                e.stopPropagation();
                if (markerDrag) return;
                markerClickCount.current[m.id] = (markerClickCount.current[m.id] ?? 0) + 1;
                if (markerClickTimer.current[m.id]) clearTimeout(markerClickTimer.current[m.id]);
                if (markerClickCount.current[m.id] >= 2) {
                  onOpenMarker(m.id); markerClickCount.current[m.id] = 0; return;
                }
                markerClickTimer.current[m.id] = setTimeout(() => { markerClickCount.current[m.id] = 0; }, 350);
              }}>
              {/* Aktive-Gruppen-Badge */}
              {activeGroups.length > 0 && (
                <div className="relative">
                  <button
                    className="flex items-center gap-0.5 bg-gray-900 bg-opacity-90 border border-gray-600 rounded-full px-1.5 py-0.5 shadow-lg"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setOpenGroupMenu(showGroupMenu ? null : m.id); }}
                    title="Aktive Gruppen – klicken zum Verwalten">
                    {activeGroups.slice(0, 5).map((g) => (
                      <span key={g.groupId} className="w-3 h-3 rounded-full border border-gray-800 flex-shrink-0"
                        style={{ backgroundColor: g.color }} title={g.label} />
                    ))}
                    {activeGroups.length > 5 && <span className="text-gray-400 text-xs">+{activeGroups.length - 5}</span>}
                  </button>
                  {/* Dropdown: Gruppen einzeln entfernen */}
                  {showGroupMenu && (
                    <div className="absolute bottom-full left-0 mb-1 bg-gray-900 border border-gray-600 rounded-xl shadow-xl p-2 min-w-max z-50"
                      onPointerDown={(e) => e.stopPropagation()}>
                      <p className="text-gray-500 text-xs mb-1.5 px-1">Gruppen auf dieser Ebene:</p>
                      {activeGroups.map((g) => (
                        <div key={g.groupId} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-800">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                          <span className="text-xs text-gray-300 flex-1">{g.label}</span>
                          <button
                            className="text-xs text-gray-600 hover:text-orange-400 px-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onMoveTokenUp) onMoveTokenUp(g.groupId, m.id);
                              else onRemoveToken?.(g.groupId, m.id);
                              setOpenGroupMenu(null);
                            }}
                            title="Gruppe auf übergeordnete Ebene verschieben">↑</button>
                        </div>
                      ))}
                      <button className="mt-1 w-full text-xs text-gray-600 hover:text-gray-400 text-center"
                        onClick={(e) => { e.stopPropagation(); setOpenGroupMenu(null); }}>schließen</button>
                    </div>
                  )}
                </div>
              )}
              {/* Marker-Label */}
              <div className={`text-xs font-bold px-2 py-0.5 rounded-full border-2 shadow-lg select-none whitespace-nowrap ${
                m.isPOI ? "bg-blue-700 border-blue-400 text-white" : "bg-yellow-500 border-yellow-300 text-black"
              } ${activeGroups.length > 0 ? "ring-2 ring-green-400 ring-offset-1 ring-offset-transparent" : ""}`}>
                {m.isPOI ? "🔵" : "📍"} {m.label}
                {isAdminProp && <span className="ml-1 opacity-50">↵↵</span>}
              </div>
            </div>
          );
        })}

        {/* Gruppen-Tokens mit Hover-Tooltip + Entfernen-Button */}
        {visibleTokens.map((t) => {
          const g = groupById(t.groupId);
          const count = groupCount(t.groupId);
          const tokenKey = `${t.groupId}:${t.mapId ?? "main"}`;
          const color = g ? groupColor(g) : "#3b82f6";
          const isHovered = hoveredToken === tokenKey;

          return (
            <div key={tokenKey}
              className={`absolute z-10 flex flex-col items-center select-none ${
                canWriteTokens ? "cursor-grab active:cursor-grabbing" : "cursor-default opacity-90"
              } ${tokenDrag === tokenKey ? "scale-110" : ""}`}
              style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, transform: `translate(-50%,-50%) scale(${Math.min(1, 1/scale)})`, transformOrigin: "center center" }}
              onPointerDown={(e) => {
                if (!canWriteTokens) return;
                // Kein Drag starten wenn auf ✕ geklickt
                if ((e.target as HTMLElement).dataset.removeBtn) return;
                e.stopPropagation();
                const el = e.currentTarget as HTMLElement;
                el.setPointerCapture(e.pointerId);
                draggingTokenEl.current = el;
                isDraggingAny.current = true;
                setTokenDrag(tokenKey); lastTokenPos.current = null;
              }}
              onPointerMove={(e) => { if (tokenDrag === tokenKey) { e.stopPropagation(); onBgMove(e); } }}
              onPointerUp={(e) => { if (tokenDrag === tokenKey) { e.stopPropagation(); onBgUp(); } }}
              onMouseEnter={() => setHoveredToken(tokenKey)}
              onMouseLeave={() => setHoveredToken(null)}
              title={canWriteTokens ? "Ziehen  ·  ✕ zum Entfernen" : "Nur Ansicht"}>
              {/* Token-Pille */}
              <div className="relative">
                <div className={`px-2 py-0.5 rounded-full border-2 shadow-lg whitespace-nowrap`}
                  style={{
                    backgroundColor: tokenDrag === tokenKey ? "#eab308" : color,
                    borderColor: tokenDrag === tokenKey ? "#fde047" : "white",
                    color: tokenDrag === tokenKey ? "black" : "white",
                  }}>
                  {g?.icon && <GroupIconDisplay icon={g.icon} size={12} />}
                  <span className="font-bold text-xs">{g?.label ?? t.groupId}</span>
                  <span className="ml-1 text-[10px] font-normal opacity-80">{count}</span>
                </div>
                {/* ✕ Entfernen-Button – erscheint beim Hovern für Admin/Commander */}
                {canWriteTokens && isHovered && !tokenDrag && (
                  <button
                    data-remove-btn="1"
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-700 border border-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600 shadow-lg cursor-pointer"
                    title="Token von Karte entfernen"
                    onPointerDown={(e) => { e.stopPropagation(); }}
                    onClick={(e) => { e.stopPropagation(); onRemoveToken(t.groupId, activeMapId); setHoveredToken(null); }}
                  >✕</button>
                )}
              </div>

              {/* Hover-Tooltip */}
              {isHovered && !tokenDrag && (
                <div className="absolute z-50 pointer-events-none"
                  style={{ top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", minWidth: 160, maxWidth: 240 }}>
                  <div className="bg-gray-900 border border-gray-600 rounded-xl shadow-2xl px-3 py-2 text-xs">
                    {buildTooltip(t.groupId)}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* ── Auftragsmarker + gestrichelte Verbindungslinien ───────────── */}
        {visibleOrderMarkers.map((m) => {
          const g = groupById(m.groupId);
          if (!g) return null;
          const color = groupColor(g);
          const isHov = hoveredOrderMarker === m.groupId;

          // Finde den Token dieser Gruppe auf dieser Karte für die Linie
          const tok = visibleTokens.find((t) => t.groupId === m.groupId);

          return (
            <React.Fragment key={`order-${m.groupId}`}>
              {/* Gestrichelte Linie Token → Auftragsmarker via SVG */}
              {tok && (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ zIndex: 8, overflow: "visible" }}>
                  <line
                    x1={`${tok.x * 100}%`} y1={`${tok.y * 100}%`}
                    x2={`${m.x * 100}%`}   y2={`${m.y * 100}%`}
                    stroke={color}
                    strokeWidth="2"
                    strokeDasharray="8 5"
                    strokeLinecap="round"
                    opacity="0.85"
                  />
                </svg>
              )}

              {/* Auftragsmarker-Badge */}
              <div
                className={`absolute z-10 flex flex-col items-center select-none ${
                  canWriteTokens ? "cursor-grab active:cursor-grabbing" : "cursor-default"
                } ${orderMarkerDrag === m.groupId ? "scale-110" : ""}`}
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: `translate(-50%,-50%) scale(${Math.min(1, 1/scale)})`, transformOrigin: "center center" }}
                onPointerDown={(e) => {
                  if (!canWriteTokens) return;
                  if ((e.target as HTMLElement).dataset.removeBtn) return;
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setOrderMarkerDrag(m.groupId); lastOrderMarkerPos.current = null;
                }}
                onPointerMove={(e) => { if (orderMarkerDrag === m.groupId) { e.stopPropagation(); onBgMove(e); } }}
                onPointerUp={(e) => { if (orderMarkerDrag === m.groupId) { e.stopPropagation(); onBgUp(); } }}
                onMouseEnter={() => setHoveredOrderMarker(m.groupId)}
                onMouseLeave={() => setHoveredOrderMarker(null)}
                title={canWriteTokens ? "Auftrag ziehen  ·  ✕ entfernen" : "Auftrag"}>
                <div className="relative">
                  {/* Flaggen-Symbol + Gruppenname */}
                  <div
                    className="px-2 py-0.5 rounded-lg border-2 shadow-lg whitespace-nowrap flex items-center gap-1.5"
                    style={{
                      backgroundColor: orderMarkerDrag === m.groupId ? "#eab308" : "#111827",
                      borderColor: color,
                      borderStyle: "dashed",
                      color: orderMarkerDrag === m.groupId ? "black" : color,
                    }}>
                    <span className="text-sm">⚑</span>
                    <span className="font-bold text-xs">{g.label}</span>
                  </div>
                  {/* ✕ Entfernen-Button */}
                  {canWriteTokens && isHov && !orderMarkerDrag && (
                    <button
                      data-remove-btn="1"
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-700 border border-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600 shadow-lg cursor-pointer"
                      title="Auftrag entfernen"
                      onPointerDown={(e) => { e.stopPropagation(); }}
                      onClick={(e) => { e.stopPropagation(); onRemoveOrderMarker(m.groupId, activeMapId); setHoveredOrderMarker(null); }}
                    >✕</button>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
        </div>{/* end imgOffset overlay */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NOTES PANEL
// ─────────────────────────────────────────────────────────────

function NotesPanel({ x, y, w, h, text, onChange, onMove, onResize, canWrite,
  systemText, onSystemChange, systemLabel, minimized, onToggleMinimize,
}: {
  x: number; y: number; w: number; h: number; text: string;
  onChange: (t: string) => void; onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void; canWrite: boolean;
  systemText?: string; onSystemChange?: (t: string) => void; systemLabel?: string;
  minimized?: boolean; onToggleMinimize?: () => void;
}) {
  const [noteTab, setNoteTab] = React.useState<"galaxy"|"system">("galaxy");
  const dragging = useRef(false);
  const start = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resizing = useRef(false);
  const resizeStart = useRef({ mx: 0, my: 0, pw: 0, ph: 0 });

  function onHeaderDown(e: React.PointerEvent) {
    dragging.current = true; start.current = { mx: e.clientX, my: e.clientY, px: x, py: y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.preventDefault();
  }
  function onHeaderMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    onMove(
        Math.max(0, Math.min(window.innerWidth  - 80, start.current.px + e.clientX - start.current.mx)),
        Math.max(0, Math.min(window.innerHeight - 40, start.current.py + e.clientY - start.current.my))
      );
  }
  function onHeaderUp() { dragging.current = false; }
  function onResizeDown(e: React.PointerEvent) {
    resizing.current = true; resizeStart.current = { mx: e.clientX, my: e.clientY, pw: w, ph: h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.stopPropagation(); e.preventDefault();
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!resizing.current) return;
    onResize(Math.max(180, resizeStart.current.pw + e.clientX - resizeStart.current.mx),
             Math.max(120, resizeStart.current.ph + e.clientY - resizeStart.current.my));
  }
  function onResizeUp() { resizing.current = false; }

  return (
    <div className="fixed z-40 rounded-xl border border-gray-600 bg-gray-900 bg-opacity-95 shadow-xl flex flex-col overflow-hidden"
      style={{ left: x, top: y, width: w, height: minimized ? "auto" : h, minWidth: 180, minHeight: minimized ? 0 : 120 }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 bg-gray-800 select-none cursor-move flex-shrink-0"
        onPointerDown={onHeaderDown} onPointerMove={onHeaderMove} onPointerUp={onHeaderUp}>
        <span className="text-gray-500 text-xs">⠿</span>
        <span className="text-xs font-semibold text-gray-300">📋 Notizen</span>
        {onSystemChange && (
          <div className="flex gap-1 ml-1">
            <button className={`text-xs px-1.5 py-0.5 rounded ${noteTab==="galaxy" ? "bg-blue-800 text-blue-200" : "text-gray-500 hover:text-gray-300"}`}
              onPointerDown={e=>e.stopPropagation()} onClick={()=>setNoteTab("galaxy")}>🌌</button>
            <button className={`text-xs px-1.5 py-0.5 rounded ${noteTab==="system" ? "bg-purple-800 text-purple-200" : "text-gray-500 hover:text-gray-300"}`}
              onPointerDown={e=>e.stopPropagation()} onClick={()=>setNoteTab("system")}>{systemLabel ?? "⭐"}</button>
          </div>
        )}
        <span className="flex-1" />
        <span className="text-gray-600 text-xs">{canWrite ? "schreibbar" : "lesend"}</span>
        {onToggleMinimize && (
          <button className="text-gray-500 hover:text-gray-300 text-xs px-1 ml-1" onPointerDown={e=>e.stopPropagation()} onClick={onToggleMinimize}>{minimized ? "□" : "─"}</button>
        )}
      </div>
      {!minimized && (noteTab === "galaxy" || !onSystemChange ? (
        <textarea className="flex-1 bg-transparent text-gray-200 text-xs px-3 py-2 resize-none focus:outline-none placeholder-gray-600 font-mono"
          placeholder={canWrite ? "🌌 Galaxieweite Notizen…" : ""}
          value={text} readOnly={!canWrite} onChange={(e) => canWrite && onChange(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()} style={{ cursor: canWrite ? "text" : "default" }} spellCheck={false} />
      ) : (
        <textarea className="flex-1 bg-transparent text-purple-100 text-xs px-3 py-2 resize-none focus:outline-none placeholder-gray-600 font-mono"
          placeholder={canWrite ? `⭐ Notizen für ${systemLabel ?? "dieses System"}…` : ""}
          value={systemText ?? ""} readOnly={!canWrite} onChange={(e) => canWrite && onSystemChange?.(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()} style={{ cursor: canWrite ? "text" : "default" }} spellCheck={false} />
      ))}
      {!minimized && <div className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-center justify-center text-gray-600 hover:text-gray-400 select-none"
        onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} title="Größe ändern">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M10 0L0 10h2L10 2V0zm0 4L4 10h2l4-4V4zm0 4l-2 2h2V8z"/>
        </svg>
      </div>}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// LOG-NOTIZEN-PANEL – Zeitgestempelte Einträge, minimierbar
// ─────────────────────────────────────────────────────────────

function LogNotesPanel({ x, y, w, h, visible, entries, onAdd, onClear, onMove, onResize, canWrite, minimized, onToggleMinimize }: {
  x: number; y: number; w: number; h: number; visible: boolean;
  entries: LogEntry[];
  onAdd: (text: string) => void;
  onClear: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  canWrite: boolean;
  minimized?: boolean; onToggleMinimize?: () => void;
}) {
  const dragging = useRef(false);
  const start = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resizing = useRef(false);
  const resizeStart = useRef({ mx: 0, my: 0, pw: 0, ph: 0 });
  const [input, setInput] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const firstTs = entries[0]?.ts ?? 0;
  const [useRelTimeLocal, setUseRelTimeLocal] = useState(false);

  function onHeaderDown(e: React.PointerEvent) {
    dragging.current = true; start.current = { mx: e.clientX, my: e.clientY, px: x, py: y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.preventDefault();
  }
  function onHeaderMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    onMove(
        Math.max(0, Math.min(window.innerWidth  - 80, start.current.px + e.clientX - start.current.mx)),
        Math.max(0, Math.min(window.innerHeight - 40, start.current.py + e.clientY - start.current.my))
      );
  }
  function onHeaderUp() { dragging.current = false; }
  function onResizeDown(e: React.PointerEvent) {
    resizing.current = true; resizeStart.current = { mx: e.clientX, my: e.clientY, pw: w, ph: h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.stopPropagation(); e.preventDefault();
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!resizing.current) return;
    onResize(Math.max(180, resizeStart.current.pw + e.clientX - resizeStart.current.mx),
             Math.max(80, resizeStart.current.ph + e.clientY - resizeStart.current.my));
  }
  function onResizeUp() { resizing.current = false; }

  function formatTs(ts: number): string {
    if (useRelTimeLocal && firstTs) {
      const mins = Math.round((ts - firstTs) / 60000);
      return `+${mins}m`;
    }
    return new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  function handleAdd() {
    const t = input.trim();
    if (!t) return;
    onAdd(t);
    setInput("");
    // Scroll to bottom
    setTimeout(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, 50);
  }

  return (
    <div className="fixed z-40 rounded-xl border border-blue-800 bg-gray-900 bg-opacity-95 shadow-xl flex flex-col overflow-hidden"
      style={{ left: x, top: y, width: w, height: (visible && !minimized) ? h : "auto", minWidth: 180 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 bg-gray-800 select-none cursor-move flex-shrink-0"
        onPointerDown={onHeaderDown} onPointerMove={onHeaderMove} onPointerUp={onHeaderUp}>
        <span className="text-gray-500 text-xs">⠿</span>
        <span className="text-xs font-semibold text-blue-300 flex-1">📟 Log-Notizen</span>
        <button
          className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${useRelTimeLocal ? "bg-blue-800 border-blue-600 text-blue-200" : "border-gray-600 text-gray-500 hover:text-gray-300"}`}
          title="Relative Zeit (+m) / Uhrzeit umschalten"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setUseRelTimeLocal(v => !v)}>
          +m
        </button>
        {canWrite && !confirmClear && (
          <button
            className="text-xs px-1.5 py-0.5 rounded border border-gray-600 text-gray-500 hover:text-red-400 hover:border-red-700 transition-colors"
            title="Log leeren"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setConfirmClear(true)}>
            🗑
          </button>
        )}
        {canWrite && confirmClear && (
          <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <button
              className="text-xs px-1.5 py-0.5 rounded border border-red-700 bg-red-900 text-red-300 hover:bg-red-700 font-bold transition-colors"
              onClick={() => { onClear(); setConfirmClear(false); }}>
              ✓ Ja, leeren
            </button>
            <button
              className="text-xs px-1.5 py-0.5 rounded border border-gray-600 text-gray-400 hover:bg-gray-700 transition-colors"
              onClick={() => setConfirmClear(false)}>
              ✕
            </button>
          </div>
        )}
        {onToggleMinimize && (
          <button className="text-gray-500 hover:text-gray-300 text-xs px-1" onPointerDown={e=>e.stopPropagation()} onClick={onToggleMinimize}>{minimized ? "□" : "─"}</button>
        )}
      </div>
      {visible && !minimized && (
        <>
          {/* Einträge */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 font-mono text-xs">
            {entries.length === 0 && (
              <div className="text-gray-600 text-center py-3">Noch keine Einträge</div>
            )}
            {entries.map((e, i) => (
              <div key={i} className="flex gap-1.5 items-start">
                <span className="text-blue-500 flex-shrink-0 min-w-[32px]">{formatTs(e.ts)}</span>
                <span className="text-gray-300 break-words flex-1">{e.text}</span>
              </div>
            ))}
          </div>
          {/* Eingabe */}
          {canWrite && (
            <div className="flex gap-1 px-2 pb-2 pt-1 border-t border-gray-800 flex-shrink-0"
              onPointerDown={(e) => e.stopPropagation()}>
              <input
                className="flex-1 bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                placeholder="Eintrag…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              />
              <button
                className="px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold"
                onClick={handleAdd}>
                +
              </button>
            </div>
          )}
          {/* Resize handle */}
          <div className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-center justify-center text-gray-600 hover:text-gray-400 select-none"
            onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} title="Größe ändern">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M10 0L0 10h2L10 2V0zm0 4L4 10h2l4-4V4zm0 4l-2 2h2V8z"/>
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// OP LOG PANEL
// ─────────────────────────────────────────────────────────────

function OpLogPanel({ x, y, w, h, visible, entries, onClear, onToggleActive, isActive, canWrite, onMove, onResize,
  isAdmin, systems, minimized, onToggleMinimize }: {
  x: number; y: number; w: number; h: number; visible: boolean;
  entries: OpLogEntry[];
  onClear: () => void;
  onToggleActive: () => void;
  isActive: boolean;
  canWrite: boolean;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  isAdmin: boolean;
  systems: StarSystem[];
  minimized?: boolean;
  onToggleMinimize?: () => void;
}) {
  const dragging = useRef(false);
  const start = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resizing = useRef(false);
  const resizeStart = useRef({ mx: 0, my: 0, pw: 0, ph: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [scopeTab, setScopeTab] = useState<"galaxy" | string>("galaxy"); // "galaxy" | systemId
  const [useRelTime, setUseRelTime] = useState(false);
  const [copied, setCopied] = useState(false);

  const SYSTEM_ABBR: Record<string, { short: string; color: string }> = {
    stanton: { short: "ST", color: "text-blue-400" },
    pyro:    { short: "PY", color: "text-red-400" },
    nyx:     { short: "NY", color: "text-green-400" },
  };

  function onHeaderDown(e: React.PointerEvent) {
    dragging.current = true; start.current = { mx: e.clientX, my: e.clientY, px: x, py: y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.preventDefault();
  }
  function onHeaderMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    onMove(
        Math.max(0, Math.min(window.innerWidth  - 80, start.current.px + e.clientX - start.current.mx)),
        Math.max(0, Math.min(window.innerHeight - 40, start.current.py + e.clientY - start.current.my))
      );
  }
  function onHeaderUp() { dragging.current = false; }
  function onResizeDown(e: React.PointerEvent) {
    resizing.current = true; resizeStart.current = { mx: e.clientX, my: e.clientY, pw: w, ph: h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.stopPropagation(); e.preventDefault();
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!resizing.current) return;
    onResize(Math.max(280, resizeStart.current.pw + e.clientX - resizeStart.current.mx),
             Math.max(120, resizeStart.current.ph + e.clientY - resizeStart.current.my));
  }
  function onResizeUp() { resizing.current = false; }

  const firstTs = entries[0]?.ts ?? 0;
  function formatTs(ts: number): string {
    if (useRelTime && firstTs) {
      const mins = Math.round((ts - firstTs) / 60000);
      return `+${mins}m`;
    }
    return new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  const filtered = scopeTab === "galaxy"
    ? entries
    : entries.filter((e) => e.systemId === scopeTab);

  // Scroll to bottom when new entries arrive
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [filtered.length]);

  const typeIcon: Record<string, string> = {
    alive:          "☠",
    respawn:        "✓",
    group_change:   "→",
    token_set:      "⬡",
    token_move:     "⬡",
    token_remove:   "⬡",
    group_add:      "＋",
    group_rename:   "✎",
    group_delete:   "✕",
    group_system:   "⬡",
    op_start:       "▶",
    op_stop:        "⏹",
  };
  const typeColor: Record<string, string> = {
    alive:          "text-red-400",
    respawn:        "text-green-400",
    group_change:   "text-blue-300",
    token_set:      "text-yellow-400",
    token_move:     "text-yellow-300",
    token_remove:   "text-gray-400",
    group_add:      "text-green-400",
    group_rename:   "text-gray-300",
    group_delete:   "text-red-400",
    group_system:   "text-purple-400",
    op_start:       "text-green-300",
    op_stop:        "text-gray-500",
  };

  return (
    <div className="fixed z-40 rounded-xl border border-purple-800 bg-gray-900 bg-opacity-95 shadow-xl flex flex-col overflow-hidden select-none"
      style={{ left: x, top: y, width: w, height: (visible && !minimized) ? h : "auto", minWidth: 280 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 bg-gray-800 cursor-move flex-shrink-0"
        onPointerDown={onHeaderDown} onPointerMove={onHeaderMove} onPointerUp={onHeaderUp}>
        <span className="text-gray-500 text-xs">⠿</span>
        <span className="text-xs font-semibold text-purple-300 flex-1">📋 Op-Log</span>
        {/* Start/Stop */}
        {canWrite && (
          <button
            className={`text-xs px-2 py-0.5 rounded border font-bold transition-colors ${
              isActive
                ? "bg-red-900 border-red-700 text-red-300 hover:bg-red-800"
                : "bg-green-900 border-green-700 text-green-300 hover:bg-green-800"
            }`}
            title={isActive ? "Aufzeichnung stoppen" : "Aufzeichnung starten"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onToggleActive}>
            {isActive ? "⏹ Stop" : "▶ Start"}
          </button>
        )}
        {/* +m toggle */}
        <button
          className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${useRelTime ? "bg-purple-800 border-purple-600 text-purple-200" : "border-gray-600 text-gray-500 hover:text-gray-300"}`}
          title="Relative Zeit / Uhrzeit"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setUseRelTime(v => !v)}>
          +m
        </button>
        {/* Kopieren */}
        <button
          className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${copied ? "border-green-600 text-green-400" : "border-gray-600 text-gray-500 hover:text-gray-200 hover:border-gray-400"}`}
          title="Op-Log in Zwischenablage kopieren"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            const lines = filtered.map((e) => `[${formatTs(e.ts)}] ${e.text}`).join("\n");
            navigator.clipboard.writeText(lines).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}>
          {copied ? "✓" : "⎘"}
        </button>
        {/* Clear – nur Admin */}
        {isAdmin && !confirmClear && (
          <button
            className="text-xs px-1.5 py-0.5 rounded border border-gray-600 text-gray-500 hover:text-red-400 hover:border-red-700 transition-colors"
            title="Op-Log leeren"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setConfirmClear(true)}>
            🗑
          </button>
        )}
        {isAdmin && confirmClear && (
          <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <button className="text-xs px-1.5 py-0.5 rounded border border-red-700 bg-red-900 text-red-300 hover:bg-red-700 font-bold"
              onClick={() => { onClear(); setConfirmClear(false); }}>✓ Ja</button>
            <button className="text-xs px-1.5 py-0.5 rounded border border-gray-600 text-gray-400 hover:bg-gray-700"
              onClick={() => setConfirmClear(false)}>✕</button>
          </div>
        )}
        {onToggleMinimize && (
          <button className="text-gray-500 hover:text-gray-300 text-xs px-1"
            onPointerDown={e => e.stopPropagation()} onClick={onToggleMinimize}>
            {minimized ? "□" : "─"}
          </button>
        )}
      </div>

      {visible && !minimized && (
        <>
          {/* Scope Tabs: 🌌 + Systeme */}
          <div className="flex border-b border-gray-700 bg-gray-850 flex-shrink-0" onPointerDown={e => e.stopPropagation()}>
            <button
              className={`px-3 py-1 text-xs font-medium border-r border-gray-700 transition-colors ${scopeTab === "galaxy" ? "text-purple-300 bg-gray-800" : "text-gray-500 hover:text-gray-300"}`}
              onClick={() => setScopeTab("galaxy")}>
              🌌
            </button>
            {systems.map((sys) => {
              const ab = SYSTEM_ABBR[sys.id] ?? { short: sys.id.slice(0, 2).toUpperCase(), color: "text-gray-400" };
              const count = entries.filter(e => e.systemId === sys.id).length;
              return (
                <button key={sys.id}
                  className={`px-3 py-1 text-xs font-medium border-r border-gray-700 transition-colors ${scopeTab === sys.id ? "bg-gray-800 " + ab.color : "text-gray-500 hover:text-gray-300"}`}
                  onClick={() => setScopeTab(sys.id)}>
                  {ab.short}{count > 0 && <span className="ml-1 text-gray-600">{count}</span>}
                </button>
              );
            })}
          </div>

          {/* Entry list */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-1 font-mono text-xs">
            {filtered.length === 0 && (
              <div className="text-gray-600 text-center py-3">Keine Einträge{scopeTab !== "galaxy" ? " für dieses System" : ""}</div>
            )}
            {filtered.map((e, i) => {
              const isSep = e.type === "op_start" || e.type === "op_stop";
              return isSep ? (
                <div key={i} className="text-center text-gray-500 text-xs py-1 border-b border-gray-700 italic">
                  <span className={typeColor[e.type]}>{typeIcon[e.type]}</span>
                  {" "}{e.text}{" "}
                  <span className="text-gray-600">{formatTs(e.ts)}</span>
                </div>
              ) : (
                <div key={i} className="flex gap-1.5 items-start py-0.5 border-b border-gray-800">
                  <span className="text-gray-500 flex-shrink-0 min-w-[32px]">{formatTs(e.ts)}</span>
                  <span className={`flex-shrink-0 w-4 text-center ${typeColor[e.type] ?? "text-gray-400"}`}>{typeIcon[e.type] ?? "·"}</span>
                  <span className="text-gray-300 break-words flex-1">{e.text}</span>
                </div>
              );
            })}
          </div>

          {/* Resize handle */}
          <div className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-center justify-center text-gray-600 hover:text-gray-400 select-none"
            onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} title="Größe ändern">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M10 0L0 10h2L10 2V0zm0 4L4 10h2l4-4V4zm0 4l-2 2h2V8z"/>
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AUTO MAP
// ─────────────────────────────────────────────────────────────

function AutoMap({ label, mapId }: { label: string; mapId: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center flex-col gap-3 bg-gray-900">
      <div className="text-gray-300 text-lg font-medium">{label}</div>
      <div className="text-gray-500 text-sm text-center">
        Kein Kartenbild. Klicke auf 🖼 im Karten-Panel um eine URL einzugeben.<br />
        <code className="text-blue-400 text-xs">z.B. https://i.example.com/{mapId}.png</code>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────

function BoardApp() {
  const searchParams = useSearchParams();
  const roomIdParam = searchParams.get("room");
  const isSetup = searchParams.get("setup") === "1";
  const [pickedRoom, setPickedRoom] = useState<string | null>(roomIdParam);
  const roomId = pickedRoom ?? roomIdParam ?? "default";

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));



  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  // roomConfig: geladen beim Login, cached für die Session
  const [roomCfg, setRoomCfg] = useState<RoomConfig | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [board, setBoard] = useState<BoardState>({
    groups: DEFAULT_GROUPS,
    columns: Object.fromEntries(DEFAULT_GROUPS.map((g) => [g.id, []])),
  });
  const [groupRoles, setGroupRoles] = useState<GroupRoles>({});

  const [tokens, setTokens] = useState<Token[]>([]);
  const [orderMarkers, setOrderMarkers] = useState<OrderMarker[]>([]);
  const orderMarkersRef = useRef<OrderMarker[]>([]);
  const [aliveState, setAliveState] = useState<PlayerAliveState>({});
  const [spawnState, setSpawnState] = useState<PlayerSpawnState>({});
  const [, setPlayerStatuses] = useState<Record<string, PlayerStatus>>({});
  const playerStatusesRef = useRef<Record<string, PlayerStatus>>({});
  const [pendingStatusPlayers, setPendingStatusPlayers] = useState<Set<string>>(() => new Set());
  const [maps, setMaps] = useState<MapEntry[]>(getDefaultMaps("pyro"));
  const [pois, setPois] = useState<POI[]>([]);
  const [tab, setTab] = useState<"board" | "map">("board");
  const [showProfile, setShowProfile] = useState(false);
  const [isNewPlayer, setIsNewPlayer] = useState(false);
  const [activeMapId, setActiveMapId] = useState("main");
  const [activeSystemId, setActiveSystemId] = useState("pyro"); // aktives System für Board-Filter
  const activeSystemIdRef = useRef(activeSystemId);
  const [minimizedPanels, setMinimizedPanels] = useState<Record<string,boolean>>({});
  const toggleMinPanel = useCallback((key: string) => { setMinimizedPanels(p => ({ ...p, [key]: !p[key] })); }, []);
  const [systems, setSystems] = useState<StarSystem[]>(DEFAULT_SYSTEMS);
  const systemsRef = React.useRef<StarSystem[]>(DEFAULT_SYSTEMS);
  const [, setPanelLayout] = useState<PanelLayout>(DEFAULT_PANEL_LAYOUT);
  // ── Lokale Panel-Positionen (nur client-seitig, kein Firestore-Sync) ──
  // ── Block 5: Panel-State isoliert – jede Position eigener State ──
  const [panelNav,      setPanelNav]      = useState({ x: DEFAULT_PANEL_LAYOUT.nav.x,    y: DEFAULT_PANEL_LAYOUT.nav.y    });
  const [panelPlacer,   setPanelPlacer]   = useState({ x: DEFAULT_PANEL_LAYOUT.placer.x, y: DEFAULT_PANEL_LAYOUT.placer.y });
  const [panelToolbar,  setPanelToolbar]  = useState({ x: DEFAULT_PANEL_LAYOUT.toolbar?.x ?? 300, y: DEFAULT_PANEL_LAYOUT.toolbar?.y ?? 16 });
  const [panelZoom, setPanelZoom] = useState({ x: DEFAULT_PANEL_LAYOUT.zoom?.x ?? 16, y: DEFAULT_PANEL_LAYOUT.zoom?.y ?? 600 });
  const [panelNotes,    setPanelNotes]    = useState({ x: DEFAULT_PANEL_LAYOUT.notes.x,    y: DEFAULT_PANEL_LAYOUT.notes.y,    w: DEFAULT_PANEL_LAYOUT.notes.w,    h: DEFAULT_PANEL_LAYOUT.notes.h    });
  const [panelLogNotes, setPanelLogNotes] = useState({ x: DEFAULT_PANEL_LAYOUT.logNotes.x, y: DEFAULT_PANEL_LAYOUT.logNotes.y, w: DEFAULT_PANEL_LAYOUT.logNotes.w, h: DEFAULT_PANEL_LAYOUT.logNotes.h, visible: DEFAULT_PANEL_LAYOUT.logNotes.visible ?? false });
  const [panelOpLog,    setPanelOpLog]    = useState({ x: DEFAULT_PANEL_LAYOUT.opLog.x,    y: DEFAULT_PANEL_LAYOUT.opLog.y,    w: DEFAULT_PANEL_LAYOUT.opLog.w,    h: DEFAULT_PANEL_LAYOUT.opLog.h,    visible: DEFAULT_PANEL_LAYOUT.opLog.visible ?? false });
  // Backward-compat: localPanelPos als berechnetes Objekt für alle Stellen die es noch lesen
  const localPanelPos = useMemo(() => ({
    nav: panelNav, placer: panelPlacer, toolbar: panelToolbar, zoom: panelZoom,
    notes: panelNotes, logNotes: panelLogNotes, opLog: panelOpLog,
  }), [panelNav, panelPlacer, panelToolbar, panelZoom, panelNotes, panelLogNotes, panelOpLog]);
  const setLocalPanelPos = (updater: (p: PanelLayout) => PanelLayout) => {
    // Shim für alle Stellen die noch setLocalPanelPos nutzen (clamp-Effects etc.)
    const cur: PanelLayout = { nav: panelNav, placer: panelPlacer, toolbar: panelToolbar, zoom: panelZoom, notes: panelNotes, logNotes: panelLogNotes, opLog: panelOpLog };
    const next = updater(cur);
    if (next.nav !== cur.nav) setPanelNav(next.nav);
    if (next.placer !== cur.placer) setPanelPlacer(next.placer);
    if (next.toolbar !== cur.toolbar) setPanelToolbar(next.toolbar);
    if (next.zoom !== cur.zoom) setPanelZoom(next.zoom);
    if (next.notes !== cur.notes) setPanelNotes(next.notes);
    if (next.logNotes !== cur.logNotes) setPanelLogNotes(next.logNotes);
    if (next.opLog !== cur.opLog) setPanelOpLog(next.opLog);
  };

  // Floating Panels können je nach Screen/Tab "aus dem Viewport" rutschen (z.B. Board → Map).
  // Dieser Clamp hält sie immer sichtbar.
  useEffect(() => {
    if (!isMounted) return;

    const pad = 8;
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

    const applyClamp = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      setLocalPanelPos((p) => {
        const navW = 340, navH = 300;
        const placerW = 280, placerH = 220;
        const toolbarW = 260, toolbarH = 160;
        const zoomW = 160, zoomH = 110;

        const notesW = p.notes.w ?? 420;
        const notesH = p.notes.h ?? 260;
        const logW = p.logNotes.w ?? 520;
        const logH = p.logNotes.h ?? 360;

        return {
          ...p,
          nav: {
            x: clamp(Number(p.nav.x) || 0, pad, Math.max(pad, vw - navW - pad)),
            y: clamp(Number(p.nav.y) || 0, pad, Math.max(pad, vh - navH - pad)),
          },
          placer: {
            x: clamp(Number(p.placer.x) || 0, pad, Math.max(pad, vw - placerW - pad)),
            y: clamp(Number(p.placer.y) || 0, pad, Math.max(pad, vh - placerH - pad)),
          },
          toolbar: {
            x: clamp(Number(p.toolbar.x) || 0, pad, Math.max(pad, vw - toolbarW - pad)),
            y: clamp(Number(p.toolbar.y) || 0, pad, Math.max(pad, vh - toolbarH - pad)),
          },
          zoom: {
            x: clamp(Number(p.zoom.x) || 0, pad, Math.max(pad, vw - zoomW - pad)),
            y: clamp(Number(p.zoom.y) || 0, pad, Math.max(pad, vh - zoomH - pad)),
          },
          notes: {
            ...p.notes,
            x: clamp(Number(p.notes.x) || 0, pad, Math.max(pad, vw - notesW - pad)),
            y: clamp(Number(p.notes.y) || 0, pad, Math.max(pad, vh - notesH - pad)),
          },
          logNotes: {
            ...p.logNotes,
            x: clamp(Number(p.logNotes.x) || 0, pad, Math.max(pad, vw - logW - pad)),
            y: clamp(Number(p.logNotes.y) || 0, pad, Math.max(pad, vh - logH - pad)),
          },
        };
      });
    };

    applyClamp();
    window.addEventListener("resize", applyClamp);
    return () => window.removeEventListener("resize", applyClamp);
  }, [isMounted, tab]);

  const [notesText, setNotesText] = useState("");
  const [systemNotesTexts, setSystemNotesTexts] = useState<Record<string,string>>({});
  const systemNotesRef = React.useRef<Record<string,string>>({});
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logEntriesRef = useRef<LogEntry[]>([]);
  const [notesVisible, setNotesVisible] = useState(true);
  const [mapUiPreferences, setMapUiPreferences] = useState<MapUiPreferences>(DEFAULT_MAP_UI_PREFERENCES);
  const loadedMapUiKey = useRef<string | null>(null);
  const mapUiStorageKey = currentPlayer ? `klabscom:map-ui:${roomId}:${currentPlayer.id}` : null;

  useEffect(() => {
    if (!mapUiStorageKey) {
      loadedMapUiKey.current = null;
      setMapUiPreferences(DEFAULT_MAP_UI_PREFERENCES);
      return;
    }
    setMapUiPreferences(loadMapUiPreferences(window.localStorage, mapUiStorageKey));
    loadedMapUiKey.current = mapUiStorageKey;
  }, [mapUiStorageKey]);

  useEffect(() => {
    if (!mapUiStorageKey || loadedMapUiKey.current !== mapUiStorageKey) return;
    saveMapUiPreferences(window.localStorage, mapUiStorageKey, mapUiPreferences);
  }, [mapUiPreferences, mapUiStorageKey]);

  // ── Op-Log state ────────────────────────────────────────────────────
  const [opLogEntries, setOpLogEntries] = useState<OpLogEntry[]>([]);
  const opLogRef = useRef<OpLogEntry[]>([]);
  const [opLogActive, setOpLogActive] = useState(false); // Standard: gestoppt
  const opLogActiveRef = useRef(false);
  // Pending timers: key → { timer, entry, prevPos? }
  const opLogPending = useRef<Record<string, PendingOpLogEntry>>({});

  // Drawing state
  const [drawings, setDrawings] = useState<DrawingsMap>({});
  const [drawTool, setDrawTool] = useState<DrawTool>("pointer");
  const [drawColor, setDrawColor] = useState("#ffffff");
  const [drawWidth, setDrawWidth] = useState(4);
  const drawingsRef = useRef<DrawingsMap>({});
  const showGrid = mapUiPreferences.showGrid;

  // Sheet-Refresh state
  const [refreshingPlayers, setRefreshingPlayers] = useState(false);
  const [playerToast, setPlayerToast] = useState<string | null>(null);
  const playerToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Zoom-Steuerung: Callbacks aus ZoomableMap hochgereicht
  const zoomInRef  = useRef<() => void>(() => {});
  const zoomOutRef = useRef<() => void>(() => {});
  const resetViewRef = useRef<() => void>(() => {});
  const [mapScale, setMapScale] = useState(1);

  const handleScaleChange = useCallback((
    scale: number,
    setScaleFn: (fn: (s: number) => number) => void,
    resetFn: () => void,
  ) => {
    setMapScale(scale);
    zoomInRef.current  = () => setScaleFn(zoomIn);
    zoomOutRef.current = () => setScaleFn(zoomOut);
    resetViewRef.current = resetFn;
  }, []);

  const [sortField, setSortField] = useState<"name" | "area" | "role" | "squadron" | "homeLocation" | "aliveStatus" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  const playersById = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);
  const canWrite = canWriteBoard(role);
  const isAdmin = canAdministerRoom(role);

  // refs
  const boardRef = useRef(board);
  const aliveRef = useRef(aliveState);
  const spawnRef = useRef(spawnState);
  const mapsRef = useRef(maps);
  const poisRef = useRef(pois);
  const tokensRef = useRef(tokens);

// ─────────────────────────────────────────────────────────────
// Map data: per-system separation (Pyro/Stanton/Nyx)
// Legacy rooms stored everything global. We treat legacy as "pyro".
// ─────────────────────────────────────────────────────────────
const LEGACY_DEFAULT_SYSTEM = "pyro";

const tokensBySystemRef = useRef<Record<string, Token[]>>({});
const orderMarkersBySystemRef = useRef<Record<string, OrderMarker[]>>({});
const mapsBySystemRef = useRef<Record<string, MapEntry[]>>({});
const poisBySystemRef = useRef<Record<string, POI[]>>({});
const drawingsBySystemRef = useRef<Record<string, DrawingsMap>>({});
const activeMapIdBySystemRef = useRef<Record<string, string>>({});
const visibleSystemIdRef = useRef(activeSystemId);
  const notesRef = useRef(notesText);
  const groupRolesRef = useRef(groupRoles);

  useEffect(() => { boardRef.current = board; }, [board]);
  useEffect(() => { aliveRef.current = aliveState; }, [aliveState]);
  useEffect(() => { spawnRef.current = spawnState; }, [spawnState]);
  useEffect(() => { mapsRef.current = maps; }, [maps]);
  useEffect(() => { poisRef.current = pois; }, [pois]);
  useEffect(() => { tokensRef.current = tokens; }, [tokens]);

// Keep per-system caches in sync with the system that is actually visible in the map UI
useEffect(() => { tokensBySystemRef.current[visibleSystemIdRef.current] = tokens; }, [tokens]);
useEffect(() => { orderMarkersBySystemRef.current[visibleSystemIdRef.current] = orderMarkers; }, [orderMarkers]);
useEffect(() => { mapsBySystemRef.current[visibleSystemIdRef.current] = normalizeMapsForSystem(visibleSystemIdRef.current, maps); }, [maps]);
useEffect(() => { poisBySystemRef.current[visibleSystemIdRef.current] = pois; }, [pois]);
useEffect(() => { drawingsBySystemRef.current[visibleSystemIdRef.current] = drawings; }, [drawings]);
useEffect(() => { activeMapIdBySystemRef.current[visibleSystemIdRef.current] = activeMapId; }, [activeMapId]);
useEffect(() => { activeSystemIdRef.current = activeSystemId; }, [activeSystemId]);

// When switching system tab, persist the previously visible system first, then load the target system
useEffect(() => {
  const prevSystemId = visibleSystemIdRef.current;

  tokensBySystemRef.current[prevSystemId] = tokensRef.current;
  orderMarkersBySystemRef.current[prevSystemId] = orderMarkersRef.current;
  mapsBySystemRef.current[prevSystemId] = normalizeMapsForSystem(prevSystemId, mapsRef.current);
  poisBySystemRef.current[prevSystemId] = poisRef.current;
  drawingsBySystemRef.current[prevSystemId] = drawingsRef.current;
  activeMapIdBySystemRef.current[prevSystemId] = activeMapIdBySystemRef.current[prevSystemId] ?? "main";

  const t = tokensBySystemRef.current[activeSystemId] ?? [];
  const om = orderMarkersBySystemRef.current[activeSystemId] ?? [];
  const m = normalizeMapsForSystem(activeSystemId, mapsBySystemRef.current[activeSystemId] ?? getDefaultMaps(activeSystemId));
  const p = poisBySystemRef.current[activeSystemId] ?? [];
  const d = drawingsBySystemRef.current[activeSystemId] ?? {};
  const am = activeMapIdBySystemRef.current[activeSystemId] ?? "main";

  visibleSystemIdRef.current = activeSystemId;

  setTokens(t); tokensRef.current = t;
  setOrderMarkers(om); orderMarkersRef.current = om;
  setMaps(m); mapsRef.current = m;
  setPois(p); poisRef.current = p;
  setDrawings(d); drawingsRef.current = d;
  setActiveMapId(am);
}, [activeSystemId]);
  useEffect(() => { orderMarkersRef.current = orderMarkers; }, [orderMarkers]);
  useEffect(() => { notesRef.current = notesText; }, [notesText]);
  useEffect(() => { logEntriesRef.current = logEntries; }, [logEntries]);
  useEffect(() => { opLogActiveRef.current = opLogActive; }, [opLogActive]);
  useEffect(() => { groupRolesRef.current = groupRoles; }, [groupRoles]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);

  // auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthReady(true); });
    return () => unsub();
  }, []);

  // ── Spieler aus Sheet laden & Board aktualisieren ──────────
  function applyPlayerList(list: Player[], showToast = false) {
    setPlayers(list);
    setBoard((prev) => {
      const all = new Set(Object.values(prev.columns).flat());
      const toAdd = list.map((p) => p.id).filter((id) => !all.has(id));
      if (!toAdd.length) return prev;
      if (showToast) {
        const msg = `${toAdd.length} neuer Spieler${toAdd.length > 1 ? "" : ""} → Unzugeteilt`;
        setPlayerToast(msg);
        if (playerToastTimer.current) clearTimeout(playerToastTimer.current);
        playerToastTimer.current = setTimeout(() => setPlayerToast(null), 5000);
      }
      return { ...prev, columns: { ...prev.columns, unassigned: [...(prev.columns.unassigned ?? []), ...toAdd] } };
    });
  }

  // Initialer Load + Echtzeit-Listener auf playerOverrides
  // Wenn ein neuer Spieler sich selbst registriert (self-registration), schreibt er sich
  // in playerOverrides → onSnapshot triggert → alle anderen Clients sehen ihn sofort.
  useEffect(() => {
    if (!roomCfg) return;
    // Initialer Load
    loadPlayersForRoom(roomId).then((sheetLoad) => {
      loadFirestoreOverrides(roomId).then((ov) => {
        applyPlayerList(mergeWithOverrides(sheetLoad.players, ov), false);
        if (sheetLoad.warning) {
          setPlayerToast(sheetLoad.warning);
          if (playerToastTimer.current) clearTimeout(playerToastTimer.current);
          playerToastTimer.current = setTimeout(() => setPlayerToast(null), 5000);
        }
      });
    });
    // Echtzeit-Listener auf playerOverrides
    const overridesRef = doc(db, "rooms", roomId, "config", "playerOverrides");
    const unsub = onSnapshot(overridesRef, (snap) => {
      if (!snap.exists()) return;
      const ov = parsePlayerOverrides(snap.data());
      firestoreOverrideCache[roomId] = ov;
      const sheetList = cachedPlayersByRoom[roomId] ?? [];
      applyPlayerList(mergeWithOverrides(sheetList, ov), false);
    });
    return () => unsub();
  }, [roomId, roomCfg]);

  // Auto-Polling alle 5 Minuten
  useEffect(() => {
    if (!roomCfg) return;
    const id = setInterval(async () => {
      const result = await loadPlayersForRoom(roomId, true);
      applyPlayerList(result.players, true);
      if (result.warning) {
        setPlayerToast(result.warning);
        if (playerToastTimer.current) clearTimeout(playerToastTimer.current);
        playerToastTimer.current = setTimeout(() => setPlayerToast(null), 5000);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [roomId, roomCfg]);

  // Manueller Refresh (für den Button im Board-Header)
  async function refreshPlayers() {
    if (refreshingPlayers) return;
    setRefreshingPlayers(true);
    try {
      const result = await loadPlayersForRoom(roomId, true);
      const list = result.players;
      applyPlayerList(list, true);
      if (result.warning) {
        setPlayerToast(result.warning);
        if (playerToastTimer.current) clearTimeout(playerToastTimer.current);
        playerToastTimer.current = setTimeout(() => setPlayerToast(null), 5000);
      } else if (!list.some(p => !new Set(Object.values(board.columns).flat()).has(p.id))) {
        setPlayerToast(`✓ ${list.length} Spieler – keine neuen`);
        if (playerToastTimer.current) clearTimeout(playerToastTimer.current);
        playerToastTimer.current = setTimeout(() => setPlayerToast(null), 3000);
      }
    } finally {
      setRefreshingPlayers(false);
    }
  }

  // role
  useEffect(() => {
    if (!user || !currentPlayer) return;
    const sheetRole = parseRole(currentPlayer.appRole);
    setRole(sheetRole);
  }, [user, currentPlayer, roomId]);

  // Beim Logout: Room-Config-Cache invalidieren damit nächster Login frisch lädt
  function handleLogout() {
    invalidateRoomConfig(roomId);
    setCurrentPlayer(null);
    setRoomCfg(null);
    setRole("viewer");
    signOut(auth);
  }

  // snapshot
  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "rooms", roomId, "state", "board");
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const parsedBoard = parseBoardState(data, DEFAULT_GROUPS);
      // Rückwärtskompatibilität: Gruppen ohne systemId bekommen "pyro" als Default
      const loadedGroups: Group[] = parsedBoard.groups.map((g) => g.systemId ? g : { ...g, systemId: "pyro" });
      setBoard({ ...parsedBoard, groups: loadedGroups });
      
// ── Map data: prefer per-system fields, fallback legacy → LEGACY_DEFAULT_SYSTEM
let didMigrate = false;

const normalizeTokensArr = (arr: unknown): Token[] => parseTokens(arr);
const normalizeOrderMarkersArr = (arr: unknown): OrderMarker[] => parseOrderMarkers(arr);

const tokensBySystem: Record<string, Token[]> =
  data.tokensBySystem && typeof data.tokensBySystem === "object"
    ? Object.fromEntries(Object.entries(data.tokensBySystem).map(([k, v]) => [k, normalizeTokensArr(v)]))
    : (() => {
        didMigrate = Array.isArray(data.tokens);
        return Array.isArray(data.tokens) ? { [LEGACY_DEFAULT_SYSTEM]: normalizeTokensArr(data.tokens) } as Record<string, Token[]> : {} as Record<string, Token[]>;
      })();

const orderMarkersBySystem: Record<string, OrderMarker[]> =
  data.orderMarkersBySystem && typeof data.orderMarkersBySystem === "object"
    ? Object.fromEntries(Object.entries(data.orderMarkersBySystem).map(([k, v]) => [k, normalizeOrderMarkersArr(v)]))
    : (() => {
        didMigrate = didMigrate || Array.isArray(data.orderMarkers);
        return Array.isArray(data.orderMarkers) ? { [LEGACY_DEFAULT_SYSTEM]: normalizeOrderMarkersArr(data.orderMarkers) } as Record<string, OrderMarker[]> : {} as Record<string, OrderMarker[]>;
      })();

const mapsBySystem: Record<string, MapEntry[]> =
  data.mapsBySystem && typeof data.mapsBySystem === "object"
    ? Object.fromEntries(Object.entries(data.mapsBySystem).map(([k, v]) => {
        const parsedMaps = parseMapEntries(v);
        return [k, parsedMaps.length > 0 ? parsedMaps : getDefaultMaps(k)];
      }))
    : (() => {
        const legacyHas = Array.isArray(data.maps) && data.maps.length > 0;
        didMigrate = didMigrate || legacyHas;
        return legacyHas ? { [LEGACY_DEFAULT_SYSTEM]: parseMapEntries(data.maps) } as Record<string, MapEntry[]> : {} as Record<string, MapEntry[]>;
      })();

const poisBySystem: Record<string, POI[]> =
  data.poisBySystem && typeof data.poisBySystem === "object"
    ? Object.fromEntries(Object.entries(data.poisBySystem).map(([k, v]) => [k, parsePois(v)]))
    : (() => {
        const legacyPois = parsePois(data.pois);
        didMigrate = didMigrate || !!data.pois;
        return { [LEGACY_DEFAULT_SYSTEM]: legacyPois } as Record<string, POI[]>;
      })();

const drawingsBySystem: Record<string, DrawingsMap> =
  data.drawingsBySystem && typeof data.drawingsBySystem === "object"
    ? (data.drawingsBySystem as Record<string, DrawingsMap>)
    : (() => {
        didMigrate = didMigrate || !!data.drawings;
        return data.drawings ? { [LEGACY_DEFAULT_SYSTEM]: data.drawings } as Record<string, DrawingsMap> : {} as Record<string, DrawingsMap>;
      })();

tokensBySystemRef.current = tokensBySystem;
orderMarkersBySystemRef.current = orderMarkersBySystem;
mapsBySystemRef.current = mapsBySystem;
poisBySystemRef.current = poisBySystem;
drawingsBySystemRef.current = drawingsBySystem;

const targetSystemId = activeSystemIdRef.current;
// ── Block 4: Refs sofort setzen (kein Re-render), dann State als Transition ──
const activeTokens = tokensBySystemRef.current[targetSystemId] ?? [];
tokensRef.current = activeTokens;

const activeOM = orderMarkersBySystemRef.current[targetSystemId] ?? [];
orderMarkersRef.current = activeOM;

const activeMaps = normalizeMapsForSystem(targetSystemId, mapsBySystemRef.current[targetSystemId] ?? getDefaultMaps(targetSystemId));
mapsRef.current = activeMaps;

const activePois = poisBySystemRef.current[targetSystemId] ?? [];
poisRef.current = activePois;

const activeDrawings = drawingsBySystemRef.current[targetSystemId] ?? {};
drawingsRef.current = activeDrawings;

const legacyAliveState = parseAliveState(data.aliveState);
const legacySpawnState = parseSpawnState(data.spawnState);
for (const status of Object.values(playerStatusesRef.current)) {
  legacyAliveState[status.playerId] = status.aliveStatus;
  if (status.spawnGroupId) legacySpawnState[status.playerId] = status.spawnGroupId;
}
aliveRef.current = legacyAliveState;
spawnRef.current = legacySpawnState;

// Alle State-Updates gebatcht als niederprioritäre Transition → UI bleibt responsiv
React.startTransition(() => {
  setTokens(activeTokens);
  setOrderMarkers(activeOM);
  setAliveState(legacyAliveState);
  setSpawnState(legacySpawnState);
  setMaps(activeMaps);
  setPois(activePois);
  setDrawings(activeDrawings);
});

if (didMigrate && !data.tokensBySystem && !data.mapsBySystem && !data.poisBySystem && !data.orderMarkersBySystem && !data.drawingsBySystem) {
  setDoc(ref, {
    tokensBySystem,
    orderMarkersBySystem,
    mapsBySystem,
    poisBySystem,
    drawingsBySystem,
    updatedAt: serverTimestamp(),
  }, { merge: true }).catch(console.error);
}
      if (data.panelLayout) {
        const pl = data.panelLayout;
        setPanelLayout({
          ...DEFAULT_PANEL_LAYOUT,
          ...pl,
          notes:    pl.notes    ? clampNotes(pl.notes,    DEFAULT_PANEL_LAYOUT.notes,    NOTES_MIN_W, NOTES_MIN_H) : DEFAULT_PANEL_LAYOUT.notes,
          logNotes: pl.logNotes ? clampNotes(pl.logNotes, DEFAULT_PANEL_LAYOUT.logNotes, LOG_MIN_W,   LOG_MIN_H)   : DEFAULT_PANEL_LAYOUT.logNotes,
          opLog:    pl.opLog    ? clampNotes(pl.opLog,    DEFAULT_PANEL_LAYOUT.opLog,    OPLOG_MIN_W, OPLOG_MIN_H) : DEFAULT_PANEL_LAYOUT.opLog,
        });
      }
      if (typeof data.notesText === "string") setNotesText(data.notesText);
      if (data.systemNotesTexts) { setSystemNotesTexts(data.systemNotesTexts); systemNotesRef.current = data.systemNotesTexts; }
      if (Array.isArray(data.logEntries)) setLogEntries(data.logEntries);
      if (Array.isArray(data.opLogEntries)) { setOpLogEntries(data.opLogEntries); opLogRef.current = data.opLogEntries; }
      if (data.groupRoles) setGroupRoles(parseGroupRoles(data.groupRoles));
      if (data.drawings) setDrawings(data.drawings);
      // Systeme (rückwärtskompatibel)
      if (Array.isArray(data.systems) && data.systems.length > 0) {
        setSystems(data.systems); systemsRef.current = data.systems;
      }
    });
    return () => unsub();
  }, [user, roomId]);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(collection(db, "rooms", roomId, "playerStatus"), (snapshot) => {
      const next: Record<string, PlayerStatus> = {};
      for (const statusDocument of snapshot.docs) {
        const status = parsePlayerStatus(statusDocument.data());
        if (status) next[status.playerId] = status;
      }
      playerStatusesRef.current = next;
      setPlayerStatuses(next);
      setAliveState((current) => {
        const merged = { ...current };
        for (const status of Object.values(next)) merged[status.playerId] = status.aliveStatus;
        aliveRef.current = merged;
        return merged;
      });
      setSpawnState((current) => {
        const merged = { ...current };
        for (const status of Object.values(next)) {
          if (status.spawnGroupId) merged[status.playerId] = status.spawnGroupId;
        }
        spawnRef.current = merged;
        return merged;
      });
    });
    return () => unsubscribe();
  }, [user, roomId]);

  // writes
async function pushTokensOnly(nt: Token[]) {
  const ref = doc(db, "rooms", roomId, "state", "board");
  const sysId = visibleSystemIdRef.current;
  tokensBySystemRef.current[sysId] = nt;
  try { await updateDoc(ref, { tokensBySystem: tokensBySystemRef.current, updatedAt: serverTimestamp() }); }
  catch { await setDoc(ref, { tokensBySystem: tokensBySystemRef.current, updatedAt: serverTimestamp() }, { merge: true }); }
}

async function pushOrderMarkersOnly(nm: OrderMarker[]) {
  const ref = doc(db, "rooms", roomId, "state", "board");
  const sysId = visibleSystemIdRef.current;
  orderMarkersBySystemRef.current[sysId] = nm;
  try { await updateDoc(ref, { orderMarkersBySystem: orderMarkersBySystemRef.current, updatedAt: serverTimestamp() }); }
  catch { await setDoc(ref, { orderMarkersBySystem: orderMarkersBySystemRef.current, updatedAt: serverTimestamp() }, { merge: true }); }
}

  // Firestore akzeptiert kein undefined – rekursiv entfernen
  function stripUndefined<T>(obj: T): T {
    if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
    if (obj !== null && typeof obj === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (v !== undefined) out[k] = stripUndefined(v);
      }
      return out as T;
    }
    return obj;
  }

  async function pushAll(nb: BoardState, nt: Token[], na: PlayerAliveState, ns: PlayerSpawnState,
    nm: MapEntry[], np: POI[], nl?: PanelLayout, ngr?: GroupRoles) {
    void na;
    void ns;
    const sysId = visibleSystemIdRef.current;
    try {
      await setDoc(doc(db, "rooms", roomId, "state", "board"), stripUndefined({
        groups: nb.groups, columns: nb.columns,
tokensBySystem: { ...tokensBySystemRef.current, [sysId]: nt },
mapsBySystem: { ...mapsBySystemRef.current, [sysId]: nm },
poisBySystem: { ...poisBySystemRef.current, [sysId]: np },
orderMarkersBySystem: { ...orderMarkersBySystemRef.current, [sysId]: orderMarkersRef.current },
drawingsBySystem: { ...drawingsBySystemRef.current, [sysId]: drawingsRef.current },
        ...(nl ? { panelLayout: nl } : {}),
        notesText: notesRef.current,
        systemNotesTexts: systemNotesRef.current,
        logEntries: logEntriesRef.current,
        groupRoles: ngr ?? groupRolesRef.current,
        systems: systemsRef.current,
        updatedAt: serverTimestamp(),
      }), { merge: true });
    } catch (err) { console.error("Firestore:", err); }
  }

  // GroupRoles
  async function setPlayerField(playerId: string, field: EditablePlayerField, value: string) {
    // Lokal updaten
    setPlayers((prev) => prev.map((p) => p.id === playerId ? { ...p, [field]: value } : p));
    // Firestore-Override speichern
    const existing = await loadFirestoreOverrides(roomId);
    const next: PlayerOverrides = {
      ...existing,
      [playerId]: { ...(existing[playerId] ?? {}), [field]: value },
    };
    firestoreOverrideCache[roomId] = next;
    await setDoc(doc(db, "rooms", roomId, "config", "playerOverrides"), next, { merge: true });
  }

  async function setPlayerAppRole(playerId: string, newRole: Role) {
    if (!user || !isAdmin) return;
    const token = await user.getIdToken(true);
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/roles/${encodeURIComponent(playerId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      body: JSON.stringify({ role: newRole }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "Rolle konnte nicht gespeichert werden.");
    setPlayers((prev) => prev.map((p) => p.id === playerId ? { ...p, appRole: newRole } : p));
  }

  function setGroupRole(gId: string, pid: string, r: "leader" | "deputy" | null) {
    if (!canWrite) return;
    setGroupRoles((prev) => {
      const gr = { ...(prev[gId] ?? {}) };
      if (r === null) {
        if (gr.leader === pid) delete gr.leader;
        if (gr.deputy === pid) delete gr.deputy;
      } else {
        // Entferne Spieler aus anderem Slot der gleichen Gruppe
        if (r === "leader") { if (gr.deputy === pid) delete gr.deputy; gr.leader = pid; }
        if (r === "deputy") { if (gr.leader === pid) delete gr.leader; gr.deputy = pid; }
      }
      const next = { ...prev, [gId]: gr };
      groupRolesRef.current = next;
      pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current, undefined, next);
      return next;
    });
  }

  // Gruppenfarbe
  function setGroupColor(id: string, hex: string) {
    if (!canWrite) return;
    setBoard((prev) => {
      const next = { ...prev, groups: prev.groups.map((g) => g.id === id ? { ...g, color: hex } : g) };
      boardRef.current = next;
      pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
      return next;
    });
  }

  function setGroupIcon(id: string, icon: string) {
    if (!canWrite) return;
    setBoard((prev) => {
      const next = { ...prev, groups: prev.groups.map((g) => g.id === id ? { ...g, icon: icon || undefined } : g) };
      boardRef.current = next;
      pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
      return next;
    });
  }

  // ── Block 2+5: stabile useCallback-Referenzen, direkte Setter ──
  // ── Viewport-Clamp: Panels bleiben immer im sichtbaren Bereich ──────────
  useEffect(() => {
    function reclamp() {
      setPanelLayout((prev) => {
        const n  = prev.notes    ?? DEFAULT_PANEL_LAYOUT.notes;
        const ln = prev.logNotes ?? DEFAULT_PANEL_LAYOUT.logNotes;
        const nSize  = clampPanelSize(n.w,  n.h,  NOTES_MIN_W, NOTES_MIN_H, n.x,  n.y);
        const nPos   = clampPanelPosition(n.x,  n.y,  nSize.w,  nSize.h);
        const lnSize = clampPanelSize(ln.w, ln.h, LOG_MIN_W,   LOG_MIN_H,   ln.x, ln.y);
        const lnPos  = clampPanelPosition(ln.x, ln.y, lnSize.w, lnSize.h);
        const next = {
          ...prev,
          notes:    { ...n,  ...nSize,  ...nPos  },
          logNotes: { ...ln, ...lnSize, ...lnPos },
        };
        // Nur setState wenn sich wirklich was geändert hat
        const same =
          prev.notes?.x === next.notes.x && prev.notes?.y === next.notes.y &&
          prev.notes?.w === next.notes.w && prev.notes?.h === next.notes.h &&
          prev.logNotes?.x === next.logNotes.x && prev.logNotes?.y === next.logNotes.y &&
          prev.logNotes?.w === next.logNotes.w && prev.logNotes?.h === next.logNotes.h;
        return same ? prev : next;
      });
    }
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, []);

  const movePanelNotes = useCallback((x: number, y: number) => {
    setPanelNotes(n => {
      const pos = clampPanelPosition(x, y, n.w, n.h);
      return { ...n, ...pos };
    });
  }, []);

  const resizePanelNotes = useCallback((w: number, h: number) => {
    setPanelNotes(n => {
      const size = clampPanelSize(w, h, NOTES_MIN_W, NOTES_MIN_H, n.x, n.y);
      const pos  = clampPanelPosition(n.x, n.y, size.w, size.h);
      return { ...n, ...size, ...pos };
    });
  }, []);

  const movePanelLogNotes = useCallback((x: number, y: number) => {
    setPanelLogNotes(ln => {
      const pos = clampPanelPosition(x, y, ln.w, ln.h);
      return { ...ln, ...pos };
    });
  }, []);

  const resizePanelLogNotes = useCallback((w: number, h: number) => {
    setPanelLogNotes(ln => {
      const size = clampPanelSize(w, h, LOG_MIN_W, LOG_MIN_H, ln.x, ln.y);
      const pos  = clampPanelPosition(ln.x, ln.y, size.w, size.h);
      return { ...ln, ...size, ...pos };
    });
  }, []);

  function toggleLogNotesVisible() {
    setLocalPanelPos(p => ({ ...p, logNotes: { ...p.logNotes, visible: !p.logNotes.visible } }));
  }

  const movePanelOpLog = useCallback((x: number, y: number) => {
    setPanelOpLog(ol => {
      const pos = clampPanelPosition(x, y, ol.w, ol.h);
      return { ...ol, ...pos };
    });
  }, []);

  const resizePanelOpLog = useCallback((w: number, h: number) => {
    setPanelOpLog(ol => {
      const size = clampPanelSize(w, h, OPLOG_MIN_W, OPLOG_MIN_H, ol.x, ol.y);
      const pos  = clampPanelPosition(ol.x, ol.y, size.w, size.h);
      return { ...ol, ...size, ...pos };
    });
  }, []);

  function toggleOpLogVisible() {
    setLocalPanelPos(p => ({ ...p, opLog: { ...p.opLog, visible: !p.opLog.visible } }));
  }

  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Op-Log Helpers ──────────────────────────────────────────────────────

  // x/y are 0.0–1.0 normalized coords → "C4", "F7" etc.
  function coordLabel(x: number, y: number): string {
    const ci = Math.min(29, Math.floor(x * 30)); // 0–29
    const col = ci < 26 ? String.fromCharCode(65 + ci) : "A" + String.fromCharCode(65 + (ci - 26));
    const row = Math.min(20, Math.floor(y * 20) + 1); // 1–20
    return `${col}${row}`;
  }

  function pushOpLog(entries: OpLogEntry[]) {
    // Firestore verträgt kein undefined – Felder ohne Wert weglassen
    const clean = entries.map(e => {
      const r: Record<string, unknown> = { ts: e.ts, actor: e.actor, type: e.type, text: e.text };
      if (e.systemId !== undefined) r.systemId = e.systemId;
      return r;
    });
    opLogRef.current = entries;
    setOpLogEntries(entries);
    setDoc(doc(db, "rooms", roomId, "state", "board"),
      { opLogEntries: clean, updatedAt: serverTimestamp() }, { merge: true }
    ).catch(console.error);
  }

  function scheduleOpLog(
    key: string,
    entry: ScheduledOpLogEntry,
    opts?: { minDist?: number; prevX?: number; prevY?: number }
  ) {
    if (!opLogActiveRef.current) return;
    const pending = opLogPending.current;

    // Startposition vom allerersten Aufruf dieser Bewegungssequenz beibehalten
    const existing = pending[key];
    const startX    = existing?.startX ?? existing?.prevX ?? opts?.prevX;
    const startY    = existing?.startY ?? existing?.prevY ?? opts?.prevY;
    const minDist   = existing?.minDist ?? opts?.minDist;

    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      const p = opLogPending.current[key];
      if (!p) return;
      delete opLogPending.current[key];

      // Distanz-Check: Startposition vs. finale newX/Y im entry
      const md = p.minDist;
      if (md !== undefined && p.prevX !== undefined && p.prevY !== undefined) {
        const finalX = p.entry.newX;
        const finalY = p.entry.newY;
        if (finalX !== undefined && finalY !== undefined) {
          const dist = Math.sqrt((finalX - p.prevX) ** 2 + (finalY - p.prevY) ** 2);
          if (dist < md) return;
        }
      }

      // Text neu generieren mit gespeicherter Startposition und finaler Position
      const finalEntry = { ...p.entry };
      const sx = p.startX;
      const sy = p.startY;
      const fx = p.entry.newX;
      const fy = p.entry.newY;
      if (sx !== undefined && sy !== undefined && fx !== undefined && fy !== undefined
          && p.entry._groupLabel) {
        finalEntry.text = `${p.entry._groupLabel}  ⬡ Token bewegt  (${p.entry._mapLabel} · ${coordLabel(sx, sy)} → ${coordLabel(fx, fy)})`;
      }

      const next = [...opLogRef.current, finalEntry];
      pushOpLog(next.length > 1000 ? next.slice(next.length - 1000) : next);
    }, 30_000); // 30s Debounce

    pending[key] = { timer, entry, prevX: startX, prevY: startY, minDist,
      startX, startY };
  }
  function handleClearOpLog() {
    if (!isAdmin) return;
    // Cancel all pending timers
    for (const p of Object.values(opLogPending.current)) clearTimeout(p.timer);
    opLogPending.current = {};
    pushOpLog([]);
  }

  function handleToggleOpLog() {
    if (!canWrite) return;
    const next = !opLogActiveRef.current;
    opLogActiveRef.current = next;
    setOpLogActive(next);
    if (next) {
      // Starten: Trennzeile in den Log
      const startEntry: OpLogEntry = {
        ts: Date.now(), actor: currentPlayer?.name ?? "?",
        type: "op_start",
        text: `── Operation gestartet (${currentPlayer?.name ?? "?"}) ──`,
      };
      const nextEntries = [...opLogRef.current, startEntry];
      pushOpLog(nextEntries);
    } else {
      // Stoppen: alle ausstehenden Timer flushen und abbrechen
      for (const p of Object.values(opLogPending.current)) {
        clearTimeout(p.timer);
        // Eintrag noch schreiben wenn er bereits 30s+ alt ist (halbe Wartezeit als Flush-Threshold)
        const age = Date.now() - p.entry.ts;
        if (age >= 30_000) {
          opLogRef.current = [...opLogRef.current, p.entry];
        }
      }
      opLogPending.current = {};
      const stopEntry: OpLogEntry = {
        ts: Date.now(), actor: currentPlayer?.name ?? "?",
        type: "op_stop",
        text: `── Operation gestoppt ──`,
      };
      pushOpLog([...opLogRef.current, stopEntry]);
    }
  }

  function handleAddLogEntry(text: string) {
    const entry: LogEntry = { ts: Date.now(), text };
    const next = [...logEntriesRef.current, entry];
    setLogEntries(next); logEntriesRef.current = next;
    setDoc(doc(db, "rooms", roomId, "state", "board"), { logEntries: next, updatedAt: serverTimestamp() }, { merge: true }).catch(console.error);
  }

  function handleClearLogEntries() {
    if (!canWrite) return;
    setLogEntries([]); logEntriesRef.current = [];
    setDoc(doc(db, "rooms", roomId, "state", "board"), { logEntries: [], updatedAt: serverTimestamp() }, { merge: true }).catch(console.error);
  }

  function handleNotesChange(text: string) {
    setNotesText(text); notesRef.current = text;
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = setTimeout(() => {
      setDoc(doc(db, "rooms", roomId, "state", "board"), { notesText: text, updatedAt: serverTimestamp() }, { merge: true }).catch(console.error);
    }, 800);
  }

  function handleSystemNotesChange(sysId: string, text: string) {
    const next = { ...systemNotesRef.current, [sysId]: text };
    setSystemNotesTexts(next); systemNotesRef.current = next;
    setDoc(doc(db, "rooms", roomId, "state", "board"), { systemNotesTexts: next, updatedAt: serverTimestamp() }, { merge: true }).catch(console.error);
  }

  async function requestPlayerStatusChange(playerId: string, action: PlayerStatusAction) {
    if (!user || !currentPlayer || pendingStatusPlayers.has(playerId)) return;
    if (playerId !== currentPlayer.id && !canWrite) return;
    const previousAlive = aliveRef.current[playerId] ?? "alive";
    const previousSpawn = spawnRef.current[playerId];
    setPendingStatusPlayers((current) => new Set(current).add(playerId));

    if (action.type === "LIVE" || action.type === "RESPAWN") {
      const optimistic = { ...aliveRef.current, [playerId]: "alive" as const };
      aliveRef.current = optimistic;
      setAliveState(optimistic);
    } else if (action.type === "TOT") {
      const optimistic = { ...aliveRef.current, [playerId]: "dead" as const };
      aliveRef.current = optimistic;
      setAliveState(optimistic);
    }
    if ("spawnGroupId" in action) {
      const optimistic = { ...spawnRef.current, [playerId]: action.spawnGroupId };
      spawnRef.current = optimistic;
      setSpawnState(optimistic);
    }

    try {
      const status = await changePlayerStatusClient({
        roomId,
        playerId,
        action,
        expectedRevision: playerStatusesRef.current[playerId]?.revision ?? 0,
        getIdToken: () => user.getIdToken(),
      });
      playerStatusesRef.current = { ...playerStatusesRef.current, [playerId]: status };
      setPlayerStatuses(playerStatusesRef.current);
      const nextAlive = { ...aliveRef.current, [playerId]: status.aliveStatus };
      aliveRef.current = nextAlive;
      setAliveState(nextAlive);
      if (status.spawnGroupId) {
        const nextSpawn = { ...spawnRef.current, [playerId]: status.spawnGroupId };
        spawnRef.current = nextSpawn;
        setSpawnState(nextSpawn);
      }
    } catch (error) {
      const rollbackAlive = { ...aliveRef.current, [playerId]: previousAlive };
      aliveRef.current = rollbackAlive;
      setAliveState(rollbackAlive);
      const rollbackSpawn = { ...spawnRef.current };
      if (previousSpawn) rollbackSpawn[playerId] = previousSpawn;
      else delete rollbackSpawn[playerId];
      spawnRef.current = rollbackSpawn;
      setSpawnState(rollbackSpawn);
      setPlayerToast(getErrorMessage(error, "Status konnte nicht gespeichert werden."));
    } finally {
      setPendingStatusPlayers((current) => {
        const next = new Set(current);
        next.delete(playerId);
        return next;
      });
    }
  }

  function toggleAlive(playerId: string) {
    const wasDead = aliveRef.current[playerId] === "dead";
    const spawnGroupId = spawnRef.current[playerId];
    const action: PlayerStatusAction = wasDead && spawnGroupId
      ? { type: "RESPAWN", spawnGroupId }
      : wasDead
        ? { type: "LIVE" }
        : { type: "TOT" };
    void requestPlayerStatusChange(playerId, action);
  }

  function setSpawn(playerId: string, spawnId: string) {
    void requestPlayerStatusChange(playerId, { type: "SET_SPAWN", spawnGroupId: spawnId });
  }

  function addGroup(isSpawn = false, systemId = "pyro") {
    if (!canWrite) return;
    const g: Group = { id: uid(), label: isSpawn ? "Spawn" : "Neue Gruppe", isSpawn, systemId };
    setBoard((prev) => {
      const next = { groups: [...prev.groups, g], columns: { ...prev.columns, [g.id]: [] } };
      boardRef.current = next;
      pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
      return next;
    });
    if (!isSpawn) {
      scheduleOpLog(`group_add:${g.id}`, { ts: Date.now(), actor: currentPlayer?.name ?? "?",
        type: "group_add", text: `Gruppe "${g.label}"  ＋ erstellt  (${systemId})`, systemId });
    }
  }

  function renameGroup(id: string, label: string) {
    if (!canWrite) return;
    const oldLabel = boardRef.current.groups.find((g) => g.id === id)?.label ?? id;
    const sysId = boardRef.current.groups.find((g) => g.id === id)?.systemId ?? "pyro";
    setBoard((prev) => {
      const next = { ...prev, groups: prev.groups.map((g) => g.id === id ? { ...g, label } : g) };
      boardRef.current = next;
      pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
      return next;
    });
    if (oldLabel !== label) {
      scheduleOpLog(`group_rename:${id}`, { ts: Date.now(), actor: currentPlayer?.name ?? "?",
        type: "group_rename", text: `Gruppe umbenannt: "${oldLabel}" → "${label}"`, systemId: sysId });
    }
  }

  function deleteGroup(id: string) {
    if (!canWrite || id === "unassigned") return;
    const g = boardRef.current.groups.find((g) => g.id === id);
    setBoard((prev) => {
      const moved = prev.columns[id] ?? [];
      const newCols = { ...prev.columns };
      delete newCols[id];
      newCols["unassigned"] = [...(newCols["unassigned"] ?? []), ...moved];
      const next = { groups: prev.groups.filter((g) => g.id !== id), columns: newCols };
      boardRef.current = next;
      const nt = tokensRef.current.filter((t) => t.groupId !== id);
      setTokens(nt); tokensRef.current = nt; pushTokensOnly(nt);
      // GroupRoles bereinigen
      const ngr = { ...groupRolesRef.current }; delete ngr[id]; groupRolesRef.current = ngr; setGroupRoles(ngr);
      pushAll(next, nt, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current, undefined, ngr);
      return next;
    });
    if (g && !g.isSpawn) {
      scheduleOpLog(`group_delete:${g.id}`, { ts: Date.now(), actor: currentPlayer?.name ?? "?",
        type: "group_delete", text: `Gruppe "${g.label}"  ✕ gelöscht`,
        systemId: g.systemId ?? "pyro" });
    }
  }

  function clearGroup(id: string) {
    if (!canWrite) return;
    setBoard((prev) => {
      const moved = prev.columns[id] ?? [];
      const next = { ...prev, columns: { ...prev.columns, unassigned: [...(prev.columns["unassigned"] ?? []), ...moved], [id]: [] } };
      boardRef.current = next;
      pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
      return next;
    });
  }

  function reorderMaps(newOrder: string[]) {
    const main = mapsRef.current.find((m) => m.id === "main")!;
    const reordered = [main, ...newOrder.map((id) => mapsRef.current.find((m) => m.id === id)!).filter(Boolean)];
    setMaps(reordered); mapsRef.current = reordered;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, reordered, poisRef.current);
  }

  function reorderPOIs(parentMapId: string, newOrder: string[]) {
    const others = poisRef.current.filter((p) => p.parentMapId !== parentMapId);
    const reordered = [...others, ...newOrder.map((id) => poisRef.current.find((p) => p.id === id)!).filter(Boolean)];
    setPois(reordered); poisRef.current = reordered;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, reordered);
  }

  function addSubmap() {
    if (!isAdmin) return;
    const m: MapEntry = { id: uid(), label: "Neue Karte", image: "", x: 0.5, y: 0.5 };
    const next = [...mapsRef.current, m]; setMaps(next); mapsRef.current = next;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, next, poisRef.current);
  }

  function renameMap(id: string, label: string) {
    const next = mapsRef.current.map((m) => m.id === id ? { ...m, label } : m);
    setMaps(next); mapsRef.current = next;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, next, poisRef.current);
  }

  function deleteMap(id: string) {
    if (!isAdmin || id === "main") return;
    const next = mapsRef.current.filter((m) => m.id !== id);
    const nextPois = poisRef.current.filter((p) => p.parentMapId !== id);
    setMaps(next); setPois(nextPois); mapsRef.current = next; poisRef.current = nextPois;
    if (activeMapId === id) setActiveMapId("main");
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, next, nextPois);
  }

  function setMapImage(id: string, image: string) {
    const inMaps = mapsRef.current.find((m) => m.id === id);
    if (inMaps) {
      const next = mapsRef.current.map((m) => m.id === id ? { ...m, image } : m);
      setMaps(next); mapsRef.current = next;
      pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, next, poisRef.current); return;
    }
    const nextPois = poisRef.current.map((p) => p.id === id ? { ...p, image } : p);
    setPois(nextPois); poisRef.current = nextPois;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, nextPois);
  }

  function moveMapMarker(id: string, x: number, y: number) {
    const next = mapsRef.current.map((m) => m.id === id ? { ...m, x, y } : m);
    setMaps(next); mapsRef.current = next;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, next, poisRef.current);
  }

  function addPOI(parentMapId: string) {
    if (!isAdmin) return;
    const p: POI = { id: uid(), label: "Neuer POI", image: "", parentMapId, x: 0.5, y: 0.5 };
    const next = [...poisRef.current, p]; setPois(next); poisRef.current = next;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, next);
  }

  function renamePOI(id: string, label: string) {
    const next = poisRef.current.map((p) => p.id === id ? { ...p, label } : p);
    setPois(next); poisRef.current = next;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, next);
  }

  function deletePOI(id: string) {
    const next = poisRef.current.filter((p) => p.id !== id);
    setPois(next); poisRef.current = next;
    if (activeMapId === id) setActiveMapId("main");
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, next);
  }

  function movePOIMarker(id: string, x: number, y: number) {
    const next = poisRef.current.map((p) => p.id === id ? { ...p, x, y } : p);
    setPois(next); poisRef.current = next;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, next);
  }

  // TOKENS
  function moveTokenLocal(gId: string, x: number, y: number, mapId: string) {
    const next = (() => {
      const prev = tokensRef.current;
      const i = prev.findIndex((t) => t.groupId === gId && (t.mapId ?? "main") === mapId);
      return i === -1 ? [...prev, { groupId: gId, x, y, mapId }] : prev.map((t, idx) => idx === i ? { ...t, x, y, mapId } : t);
    })();
    tokensRef.current = next;
    setTokens(next);
  }

  // Gibt alle Vorfahren-Map-IDs zurück (von mapId bis "main")
  function getAncestorMapIds(mapId: string): string[] {
    const ancestors: string[] = [];
    let current = mapId;
    while (current !== "main") {
      const poi = poisRef.current.find((p) => p.id === current);
      if (poi) { ancestors.push(poi.parentMapId); current = poi.parentMapId; }
      else {
        const map = mapsRef.current.find((m) => m.id === current);
        if (map && map.id !== "main") { ancestors.push("main"); current = "main"; }
        else break;
      }
    }
    return ancestors;
  }

  function commitToken(gId: string, x: number, y: number, mapId: string) {
    const prev = parseTokens(tokensRef.current);
    const i = prev.findIndex((t) => t.groupId === gId && (t.mapId ?? "main") === mapId);
    const isNew = i === -1;
    const oldToken = isNew ? null : prev[i];

    // Token setzen / bewegen
    let next = isNew
      ? [...prev, { groupId: gId, x, y, mapId }]
      : prev.map((t, idx) => idx === i ? { ...t, x, y, mapId } : t);

    if (mapId === "main") {
      // Token auf Hauptkarte → alle Tokens dieser Gruppe auf Unterkarten entfernen
      const subIds = new Set([
        ...mapsRef.current.filter((m) => m.id !== "main").map((m) => m.id),
        ...poisRef.current.map((p) => p.id),
      ]);
      next = next.filter((t) => !(t.groupId === gId && subIds.has(t.mapId ?? "")));
      // Re-add the newly placed token
      const stillHere = next.find((t) => t.groupId === gId && (t.mapId ?? "main") === "main");
      if (!stillHere) next = [...next, { groupId: gId, x, y, mapId: "main" }];
    } else {
      // Token auf Unterkarte/POI → alle Tokens dieser Gruppe auf Vorfahren-Ebenen entfernen
      const ancestorIds = new Set(getAncestorMapIds(mapId));
      ancestorIds.add("main"); // immer auch main entfernen
      next = next.filter((t) => !(t.groupId === gId && (ancestorIds.has(t.mapId ?? "main") || (t.mapId == null && ancestorIds.has("main")))));
      // Re-add the newly placed token on current mapId
      const stillHere = next.find((t) => t.groupId === gId && (t.mapId ?? "main") === mapId);
      if (!stillHere) next = [...next, { groupId: gId, x, y, mapId }];
    }

    setTokens(next); tokensRef.current = next; pushTokensOnly(next);
    // ── Op-Log ──────────────────────────────────────────────────
    const g = boardRef.current.groups.find((gg) => gg.id === gId);
    if (g && !g.isSpawn) {
      const sysId = g.systemId ?? "pyro";
      const sysLabel = systems.find((s) => s.id === sysId)?.label ?? sysId;
      const allMaps = [...mapsRef.current, ...poisRef.current];
      // "main" = Systemname (z.B. "Pyro"), Unterkarten/POIs = ihr Label
      const getMapLabel = (id: string) => id === "main" ? sysLabel : (allMaps.find((m) => m.id === id)?.label ?? id);
      const actor = currentPlayer?.name ?? "?";

      // Token dieser Gruppe auf einer anderen Ebene VOR dem Commit
      const prevOnOtherMap = prev.find((t) => t.groupId === gId && (t.mapId ?? "main") !== mapId);

      if (prevOnOtherMap) {
        // ── Ebenen-Wechsel: vollständigen Pfad aufbauen ──
        // z.B. Stanton → Daymar → Lamina PAF-I
        function buildPath(startId: string, endId: string): string {
          // Pfad von root bis startId
          function pathFromRoot(id: string): string[] {
            const parts: string[] = [];
            let cur = id;
            while (cur && cur !== "main") {
              const entry = allMaps.find((m) => m.id === cur);
              const poi = poisRef.current.find((p) => p.id === cur);
              if (entry) { parts.unshift(entry.label); cur = poi?.parentMapId ?? "main"; }
              else break;
            }
            parts.unshift(sysLabel); // System immer an erster Stelle
            return parts;
          }
          const fromPath = pathFromRoot(startId);
          const toPath   = pathFromRoot(endId);
          // Gemeinsamen Prefix finden
          let common = 0;
          while (common < fromPath.length && common < toPath.length && fromPath[common] === toPath[common]) common++;
          // Von-Seite: alles ab dem ersten unterschiedlichen Segment
          const fromPart = fromPath.slice(common).join("→") || fromPath[fromPath.length - 1];
          const toPart   = toPath.slice(common).join("→")   || toPath[toPath.length - 1];
          // Gemeinsamer Präfix + Von→Nach
          const prefix = fromPath.slice(0, common).join("→");
          if (prefix) return `${prefix}  (${fromPart}→${toPart})`;
          return `${fromPart} → ${toPart}`;
        }
        const fromId = prevOnOtherMap.mapId ?? "main";
        const fullPath = buildPath(fromId, mapId);
        scheduleOpLog(`token_level:${gId}`, {
          ts: Date.now(), actor, type: "token_set",
          text: `${g.label}  ⬡ Ebene  ${fullPath}  (${coordLabel(prevOnOtherMap.x, prevOnOtherMap.y)}→${coordLabel(x, y)})`,
          systemId: sysId,
        });
        // Alle laufenden Move-Timer dieser Gruppe canceln – frischer Start auf neuer Ebene
        const pendingKeys = Object.keys(opLogPending.current).filter(k => k.startsWith(`token_move:${gId}:`));
        pendingKeys.forEach(k => { clearTimeout(opLogPending.current[k].timer); delete opLogPending.current[k]; });
      } else if (isNew) {
        // ── Token neu gesetzt ──
        scheduleOpLog(`token_set:${gId}:${mapId}`, {
          ts: Date.now(), actor, type: "token_set",
          text: `${g.label}  ⬡ Token gesetzt  (${getMapLabel(mapId)} · ${coordLabel(x, y)})`,
          systemId: sysId,
        });
      } else {
        // ── Token bewegt (gleiche Ebene) – sofort loggen wenn Mindestdistanz überschritten ──
        // (commitToken wird nur einmal beim pointerUp aufgerufen, kein Debounce nötig)
        const dist = Math.sqrt((x - oldToken!.x) ** 2 + (y - oldToken!.y) ** 2);
        if (dist >= 0.02) { // ~0.6 Gitterfelder Mindestdistanz
          scheduleOpLog(`token_move:${gId}:${mapId}`, {
            ts: Date.now(), actor, type: "token_move",
            text: `${g.label}  ⬡ Token bewegt  (${getMapLabel(mapId)} · ${coordLabel(oldToken!.x, oldToken!.y)} → ${coordLabel(x, y)})`,
            systemId: sysId,
          });
        }
      }
    }
  }

  function upsertToken(gId: string, x: number, y: number, mapId: string) {
    commitToken(gId, x, y, mapId);
  }

  function removeToken(gId: string, mapId: string) {
    if (!canWrite) return;
    const next = tokensRef.current.filter((t) => !(t.groupId === gId && (t.mapId ?? "main") === mapId));
    setTokens(next); tokensRef.current = next; pushTokensOnly(next);
    // ── Op-Log: sofort ──────────────────────────────────────────
    const g = boardRef.current.groups.find((g) => g.id === gId);
    if (g && !g.isSpawn) {
      const mapLabel = [...mapsRef.current, ...poisRef.current].find((m) => m.id === mapId)?.label ?? mapId;
      scheduleOpLog(`token_remove:${gId}`, { ts: Date.now(), actor: currentPlayer?.name ?? "?", type: "token_remove",
        text: `${g.label}  ⬡ Token entfernt  (${mapLabel})`,
        systemId: g.systemId ?? "pyro" });
    }
  }


  // Token von Unterkarte/POI auf übergeordnete Karte verschieben
  // fromMapId = die Unterkarte/POI-ID, auf der der Token gerade liegt
  function moveTokenUp(gId: string, fromMapId: string) {
    if (!canWrite) return;

    // Kontext-abhängig:
    // - User ist auf "main" → Token direkt auf main holen (egal wie tief verschachtelt)
    // - User ist auf Unterkarte → genau eine Ebene hoch
    const onMain = activeMapId === "main";

    let targetMapId: string;
    let posX: number;
    let posY: number;

    if (onMain) {
      // Alle Ebenen hochlaufen bis wir das Element finden das direkt auf main liegt
      let currentId = fromMapId;
      posX = 0.5; posY = 0.5;
      while (currentId !== "main") {
        const poi = poisRef.current.find((p) => p.id === currentId);
        if (poi) {
          posX = poi.x ?? 0.5;
          posY = poi.y ?? 0.5;
          currentId = poi.parentMapId;
        } else {
          const mapEntry = mapsRef.current.find((m) => m.id === currentId);
          posX = mapEntry?.x ?? 0.5;
          posY = mapEntry?.y ?? 0.5;
          currentId = "main";
        }
      }
      targetMapId = "main";
    } else {
      // Genau eine Ebene hoch
      const poi = poisRef.current.find((p) => p.id === fromMapId);
      if (poi) {
        targetMapId = poi.parentMapId;
        posX = poi.x ?? 0.5;
        posY = poi.y ?? 0.5;
      } else {
        const mapEntry = mapsRef.current.find((m) => m.id === fromMapId);
        targetMapId = "main";
        posX = mapEntry?.x ?? 0.5;
        posY = mapEntry?.y ?? 0.5;
      }
    }

    // Alle Sub-Map-IDs sammeln (alle POIs + Unterkarten außer "main")
    const allSubIds = new Set([
      ...mapsRef.current.filter((m) => m.id !== "main").map((m) => m.id),
      ...poisRef.current.map((p) => p.id),
    ]);

    // Beim Hochziehen auf main: Token dieser Gruppe von ALLEN Unter-Ebenen entfernen
    // Beim Hochziehen eine Ebene: nur den Token von fromMapId entfernen
    const withoutOld = onMain
      ? tokensRef.current.filter((t) => !(t.groupId === gId && allSubIds.has(t.mapId ?? "")))
      : tokensRef.current.filter((t) => !(t.groupId === gId && (t.mapId ?? "main") === fromMapId));

    const existing = withoutOld.findIndex(
      (t) => t.groupId === gId && (t.mapId ?? "main") === targetMapId
    );
    const next = existing === -1
      ? [...withoutOld, { groupId: gId, x: posX, y: posY, mapId: targetMapId }]
      : withoutOld.map((t, i) => i === existing ? { ...t, x: posX, y: posY } : t);

    setTokens(next); tokensRef.current = next; pushTokensOnly(next);
  }

  function setGroupSystem(gId: string, sysId: string) {
    if (!canWrite) return;
    const g = boardRef.current.groups.find((g) => g.id === gId);
    const oldSys = g?.systemId ?? "pyro";
    const next: BoardState = {
      ...boardRef.current,
      groups: boardRef.current.groups.map((g) => g.id === gId ? { ...g, systemId: sysId } : g),
    };
    setBoard(next); boardRef.current = next;
    pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
    if (g && !g.isSpawn && oldSys !== sysId) {
      scheduleOpLog(`group_system:${gId}`, { ts: Date.now(), actor: currentPlayer?.name ?? "?",
        type: "group_system", text: `${g.label}  → ${sysId}  (war: ${oldSys})`,
        systemId: sysId });
    }
  }


  function upsertOrderMarker(gId: string, x: number, y: number, mapId: string) {
    if (!canWrite) return;
    const prev = orderMarkersRef.current;
    const i = prev.findIndex((m) => m.groupId === gId && m.mapId === mapId);
    const next = i === -1
      ? [...prev, { groupId: gId, x, y, mapId }]
      : prev.map((m, idx) => idx === i ? { ...m, x, y } : m);
    setOrderMarkers(next); orderMarkersRef.current = next; pushOrderMarkersOnly(next);
  }

  function moveOrderMarkerLocal(gId: string, x: number, y: number, mapId: string) {
    setOrderMarkers((prev) => {
      const i = prev.findIndex((m) => m.groupId === gId && m.mapId === mapId);
      return i === -1 ? prev : prev.map((m, idx) => idx === i ? { ...m, x, y } : m);
    });
  }

  function removeOrderMarker(gId: string, mapId: string) {
    if (!canWrite) return;
    const next = orderMarkersRef.current.filter((m) => !(m.groupId === gId && m.mapId === mapId));
    setOrderMarkers(next); orderMarkersRef.current = next; pushOrderMarkersOnly(next);
  }

  // ── DRAWINGS ──────────────────────────────────────────────

  // Separate Firestore-Schreibfunktion für Drawings (debounced)
  const drawDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushDrawings(nd: DrawingsMap) {
    if (drawDebounce.current) clearTimeout(drawDebounce.current);
    drawDebounce.current = setTimeout(() => {
      setDoc(doc(db, "rooms", roomId, "state", "board"),
        { drawings: nd, updatedAt: serverTimestamp() }, { merge: true }
      ).catch(console.error);
    }, 300);
  }

  function addDrawElement(el: DrawElement) {
    if (!canWrite) return;
    setDrawings((prev) => {
      const mapEls = [...(prev[activeMapId] ?? []), el];
      const next = { ...prev, [activeMapId]: mapEls };
      drawingsRef.current = next;
      pushDrawings(next);
      return next;
    });
  }

  function removeDrawElement(id: string) {
    if (!canWrite) return;
    setDrawings((prev) => {
      const mapEls = (prev[activeMapId] ?? []).filter((el) => el.id !== id);
      const next = { ...prev, [activeMapId]: mapEls };
      drawingsRef.current = next;
      pushDrawings(next);
      return next;
    });
  }

  function updateDrawElement(el: DrawElement) {
    if (!canWrite) return;
    setDrawings((prev) => {
      const mapEls = (prev[activeMapId] ?? []).map((e) => e.id === el.id ? el : e);
      const next = { ...prev, [activeMapId]: mapEls };
      drawingsRef.current = next;
      pushDrawings(next);
      return next;
    });
  }

  function undoDrawElement() {
    if (!canWrite) return;
    setDrawings((prev) => {
      const mapEls = (prev[activeMapId] ?? []);
      if (mapEls.length === 0) return prev;
      const next = { ...prev, [activeMapId]: mapEls.slice(0, -1) };
      drawingsRef.current = next;
      pushDrawings(next);
      return next;
    });
  }

  function clearDrawings() {
    if (!canWrite) return;
    setDrawings((prev) => {
      const next = { ...prev, [activeMapId]: [] };
      drawingsRef.current = next;
      pushDrawings(next);
      return next;
    });
  }

  // BOARD DND – auch Gruppen-Spalten verschiebbar (via Gruppen-ID als active)
  function findContainer(pid: string): string | null {
    for (const [gId, ids] of Object.entries(board.columns)) {
      if ((ids ?? []).includes(pid)) return gId;
    }
    return null;
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = e.active.id.toString();
    const isSelf = activeId === currentPlayer?.id;
    if (!canWrite && !isSelf) return;
    const overId = e.over?.id?.toString();
    if (!overId) return;

    // BUGFIX: Gruppen-Spalten verschieben (activeId ist eine Gruppen-ID, nicht Spieler-ID)
    const groupIds = board.groups.map((g) => g.id);
    const isGroupDrag = groupIds.includes(activeId) && activeId !== "unassigned";
    const overIsGroup = groupIds.includes(overId);

    if (isGroupDrag && overIsGroup && canWrite) {
      // Gruppe an neue Position in groups-Array schieben
      setBoard((prev) => {
        const oldIdx = prev.groups.findIndex((g) => g.id === activeId);
        const newIdx = prev.groups.findIndex((g) => g.id === overId);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev;
        const next = { ...prev, groups: arrayMove(prev.groups, oldIdx, newIdx) };
        boardRef.current = next;
        pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
        return next;
      });
      return;
    }

    const from = findContainer(activeId);
    const to = overIsGroup ? overId : findContainer(overId);
    if (!from || !to) return;

    if (from === to) {
      const oi = (board.columns[from] ?? []).indexOf(activeId);
      const ni = (board.columns[from] ?? []).indexOf(overId);
      if (oi !== -1 && ni !== -1 && oi !== ni) {
        setBoard((prev) => {
          const next = { ...prev, columns: { ...prev.columns, [from]: arrayMove(prev.columns[from] ?? [], oi, ni) } };
          boardRef.current = next; pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
          return next;
        });
      }
      return;
    }

    // ── Op-Log: Spieler wechselt Gruppe ────────────────────────────
    const player = playersById[activeId];
    if (player) {
      const fromGroup = boardRef.current.groups.find((g) => g.id === from);
      const toGroup   = boardRef.current.groups.find((g) => g.id === to);
      const sysId = toGroup?.systemId ?? fromGroup?.systemId ?? visibleSystemIdRef.current;
      scheduleOpLog(`group_change:${activeId}`, {
        ts: Date.now(), actor: currentPlayer?.name ?? "?", type: "group_change",
        text: `${player.name}  → ${toGroup?.label ?? to}  (war: ${fromGroup?.label ?? from})`,
        systemId: sysId,
      });
    }
    setBoard((prev) => {
      const next: BoardState = { ...prev, columns: { ...prev.columns,
        [from]: (prev.columns[from] ?? []).filter((x) => x !== activeId),
        [to]: [activeId, ...(prev.columns[to] ?? [])],
      }};
      boardRef.current = next; pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
      return next;
    });
  }

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  const filteredSortedUnassigned = useMemo(() => {
    let ids = [...(board.columns["unassigned"] ?? [])];
    if (search.trim()) {
      const q = search.toLowerCase();
      ids = ids.filter((id) => {
        const p = playersById[id];
        if (!p) return false;
        return [p.name, p.area, p.role, p.squadron, p.homeLocation].some((v) => v?.toLowerCase().includes(q));
      });
    }
    if (sortField) {
      ids.sort((a, b) => {
        const pa = playersById[a]; const pb = playersById[b];
        if (!pa || !pb) return 0;
        if (sortField === "aliveStatus") {
          const va = aliveState[a] === "dead" ? 1 : 0; const vb = aliveState[b] === "dead" ? 1 : 0;
          return sortDir === "asc" ? va - vb : vb - va;
        }
        const va = (pa[sortField] ?? "").toLowerCase(); const vb = (pb[sortField] ?? "").toLowerCase();
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return ids;
  }, [board.columns, search, sortField, sortDir, playersById, aliveState]);

  const displayMaps = useMemo(
    () => normalizeMapsForSystem(activeSystemId, maps),
    [activeSystemId, maps]
  );

  const activeMapEntry = displayMaps.find((m) => m.id === activeMapId);
  const activePOI = pois.find((p) => p.id === activeMapId);
  const activeImage = normalizeImageUrl(activeMapEntry?.image ?? activePOI?.image ?? "");
  const activeLabel = activeMapEntry?.label ?? activePOI?.label ?? "";

  // Build a map: childMapId → groups with tokens there (recursively through all levels)
  const tokensByMap = useMemo(() => {
    const result: Record<string, { groupId: string; color: string; label: string }[]> = {};
    for (const t of tokens) {
      const mid = t.mapId ?? "main";
      if (!result[mid]) result[mid] = [];
      const g = board.groups.find((g) => g.id === t.groupId);
      if (g && !result[mid].find((e) => e.groupId === t.groupId)) {
        result[mid].push({ groupId: g.id, color: groupColor(g), label: g.label });
      }
    }
    return result;
  }, [tokens, board.groups]);

  // For a marker (child map/POI), collect all groups active on it or any of its descendants
  function getActiveGroupsForMarker(markerId: string): { groupId: string; color: string; label: string }[] {
    const direct = tokensByMap[markerId] ?? [];
    // Also collect from sub-POIs of this map
    const subPois = pois.filter((p) => p.parentMapId === markerId);
    const indirect: { groupId: string; color: string; label: string }[] = [];
    for (const sp of subPois) {
      for (const g of (tokensByMap[sp.id] ?? [])) {
        if (!indirect.find((e) => e.groupId === g.groupId) && !direct.find((e) => e.groupId === g.groupId))
          indirect.push({ ...g });
      }
    }
    return [...direct, ...indirect];
  }

  const markersOnActive = useMemo(() => {
    if (activeMapId === "main") {
      return displayMaps
        .filter((m) => m.id !== "main")
        .map((m) => ({ id: m.id, label: m.label, x: m.x ?? 0.5, y: m.y ?? 0.5, isPOI: false }));
    }
    return pois
      .filter((p) => p.parentMapId === activeMapId)
      .map((p) => ({ id: p.id, label: p.label, x: p.x ?? 0.5, y: p.y ?? 0.5, isPOI: true }));
  }, [activeMapId, displayMaps, pois]);

  function handleCommitMarker(id: string, x: number, y: number) {
    if (mapsRef.current.find((m) => m.id === id)) moveMapMarker(id, x, y);
    else movePOIMarker(id, x, y);
  }

  const breadcrumb = useMemo(() => {
    if (activeMapId === "main") return [{ id: "main", label: displayMaps.find((m) => m.id === "main")?.label ?? "Hauptkarte" }];
    const sub = displayMaps.find((m) => m.id === activeMapId);
    if (sub) return [{ id: "main", label: displayMaps.find((m) => m.id === "main")?.label ?? "Hauptkarte" }, { id: sub.id, label: sub.label }];
    const poi = pois.find((p) => p.id === activeMapId);
    if (poi) {
      const parent = displayMaps.find((m) => m.id === poi.parentMapId);
      return [
        { id: "main", label: displayMaps.find((m) => m.id === "main")?.label ?? "Hauptkarte" },
        { id: poi.parentMapId, label: parent?.label ?? "Unterkarte" },
        { id: poi.id, label: poi.label },
      ];
    }
    return [{ id: "main", label: "Hauptkarte" }];
  }, [activeMapId, displayMaps, pois]);

  const selfAlive = currentPlayer ? aliveState[currentPlayer.id] ?? "alive" : "alive";
  const spawnGroups = board.groups.filter((g) => g.isSpawn && (g.systemId ?? "stanton") === activeSystemId);
  const allTacticalGroups = board.groups.filter((g) => g.id !== "unassigned" && !g.isSpawn);
  const tacticalGroups = allTacticalGroups.filter((g) => (g.systemId ?? "stanton") === activeSystemId);
  const unassignedGroup = board.groups.find((g) => g.id === "unassigned")!;

  if (!authReady) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">Laden…</div></div>
  );
  // Kein Raum → Room-Picker zeigen
  if (!pickedRoom && !roomIdParam) return (
    <RoomPickerView
      onPick={(r) => setPickedRoom(r)}
      onSetup={(r) => { setPickedRoom(r); }}
    />
  );

  if (!user || !currentPlayer) return isSetup ? (
    <RoomSetupView roomId={roomId} onDone={(p, cfg) => {
      setCurrentPlayer(p);
      setRoomCfg(cfg);
      window.history.replaceState({}, "", "?room=" + roomId);
    }} />
  ) : (
    <LoginView roomId={roomId} onLogin={(p, cfg) => {
      const hasProfile = !!(p.area || p.role || p.squadron || p.homeLocation);
      setIsNewPlayer(!hasProfile);
      setShowProfile(!hasProfile);
      setCurrentPlayer(p); setRoomCfg(cfg);
    }} onBack={() => {
      setPickedRoom(null);
      window.history.replaceState({}, "", window.location.pathname);
    }} />
  );

  const roleBadge =
    role === "admin" ? "bg-red-900 text-red-300 border border-red-700" :
    role === "commander" ? "bg-blue-900 text-blue-300 border border-blue-700" :
    "bg-gray-800 text-gray-400 border border-gray-600";

  const displayRoomName = roomCfg?.roomName || roomId;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <header className="flex-shrink-0 border-b border-gray-800 bg-gray-900 z-30">
        <div className="px-4 py-2 flex items-center gap-3 min-h-[52px]">

          {/* LINKS: KlabsCom + Raumname + Spieler-Info */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-white font-black text-xl tracking-tight">KlabsCom</span>
            <span className="text-gray-700 text-xs">v{APP_VERSION}</span>
            <span className="text-gray-500 text-sm font-mono">{displayRoomName}</span>
            <span className="w-px h-5 bg-gray-700 flex-shrink-0" />
            <span className="text-sm text-gray-300 font-medium">{currentPlayer.name}</span>
            <button className="text-xs text-gray-500 hover:text-red-400 px-1 border border-gray-700 rounded hover:border-red-700 transition-colors" onClick={handleLogout} title="Ausloggen">
              Logout
            </button>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge}`}>{role}</span>
            <button title="Eigenes Profil bearbeiten" onClick={() => setShowProfile(true)}
              className="text-xs px-2 py-1 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700">
              ✎ Profil
            </button>
            <button
              title="Spielerliste aus Sheet neu laden"
              onClick={refreshPlayers}
              disabled={refreshingPlayers}
              className="text-xs px-2 py-1 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1">
              <span className={refreshingPlayers ? "animate-spin inline-block" : ""}>↻</span>
            </button>
            {roomCfg?.sheetShareUrl && (
              <button
                title={`Sheet-Link kopieren: ${roomCfg.sheetShareUrl}`}
                onClick={() => {
                  navigator.clipboard.writeText(roomCfg!.sheetShareUrl!).then(() => {
                    const el = document.getElementById("sheet-copy-btn");
                    if (el) { el.textContent = "✓"; setTimeout(() => { if (el) el.textContent = "📊"; }, 1500); }
                  });
                }}
                id="sheet-copy-btn"
                className="text-xs px-2 py-1 rounded border border-gray-700 bg-gray-800 text-green-400 hover:bg-gray-700">
                📊
              </button>
            )}
            <span className="w-px h-4 bg-gray-700 flex-shrink-0" />
            {/* Notizen (rechteckig, bestehend) */}
            <button
              className={`text-xs px-2 py-1 rounded border transition-colors ${notesVisible ? "bg-gray-700 border-gray-500 text-gray-200" : "border-gray-700 text-gray-600 hover:text-gray-300"}`}
              onClick={() => setNotesVisible(v => !v)} title="Notizen ein/ausblenden">📋</button>

            <span className="w-px h-4 bg-gray-700 flex-shrink-0" />

            {/* Runde Panel-Buttons */}
            {[
              { key: "lognotes", icon: "📟", title: "Log-Notizen",   show: localPanelPos.logNotes.visible, toggle: toggleLogNotesVisible,          active: "bg-blue-900 border-blue-600 text-blue-200" },
              { key: "oplog",    icon: "🗒",  title: `Op-Log${opLogActive ? " ▶" : ""}`, show: localPanelPos.opLog.visible, toggle: toggleOpLogVisible, active: "bg-purple-900 border-purple-600 text-purple-200" },
            ].map(({ key, icon, title, show, toggle, active }) => (
              <button key={key}
                className={`w-7 h-7 rounded-full border text-xs flex items-center justify-center transition-colors flex-shrink-0 ${show ? active : "border-gray-700 text-gray-600 hover:text-gray-300 hover:border-gray-500"}`}
                onClick={toggle}
                title={title}>
                {key === "oplog" && opLogActive ? <><span>{icon}</span><span className="text-green-400 text-xs leading-none">▶</span></> : icon}
              </button>
            ))}

          </div>

          {/* MITTE: Lebt/Tot Button – nimmt verfügbaren Platz */}
          <div className="flex-1 flex justify-center">
            <button
              className={`px-12 py-1.5 rounded-lg border-2 font-black text-lg transition-colors w-full max-w-xs ${
                selfAlive === "dead"
                  ? "bg-red-900 border-red-600 text-red-200 hover:bg-red-800"
                  : "bg-green-900 border-green-600 text-green-200 hover:bg-green-800"
              } disabled:cursor-wait disabled:opacity-60`}
              disabled={pendingStatusPlayers.has(currentPlayer.id)}
              onClick={() => toggleAlive(currentPlayer.id)}>
              {pendingStatusPlayers.has(currentPlayer.id) ? "… SPEICHERT" : selfAlive === "dead" ? "☠ TOT" : "✓ LEBT"}
            </button>
          </div>

          {/* RECHTS: Board / Karte Tabs */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {(["board", "map"] as ("board" | "map")[]).map((tVal) => (
              <button key={tVal}
                className={`px-6 py-1.5 text-base font-black rounded-lg border transition-colors ${
                  tab === tVal
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                }`}
                onClick={() => setTab(tVal)}>
                {tVal === "board" ? "Board" : "Karte"}
              </button>
            ))}
          </div>

        </div>
      </header>

      {/* Profil-Modal */}
      {showProfile && currentPlayer && (
        <ProfileModal
          player={currentPlayer}
          roomId={roomId}
          isNew={isNewPlayer}
          onSave={(updated) => {
            setCurrentPlayer(updated);
            setIsNewPlayer(false);
            setShowProfile(false);
            cachedPlayersByRoom[roomId] = (cachedPlayersByRoom[roomId] ?? []).map(
              (p) => p.id === updated.id ? updated : p
            );
          }}
          onClose={() => { if (!isNewPlayer) setShowProfile(false); }}
        />
      )}

      {/* Toast – neue Spieler gefunden */}
      {playerToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 bg-gray-900 border border-blue-600 text-blue-300 text-sm px-4 py-2 rounded-xl shadow-xl pointer-events-none animate-pulse">
          👤 {playerToast}
        </div>
      )}

      {/* BOARD – Block 3: display:none statt Unmount */}
      <div className="flex-1 overflow-auto p-4"
        style={{ display: tab === "board" ? "block" : "none" }}>
          {/* System-Tabs */}
          <div className="flex items-center gap-2 mb-3">
            {systems.map((sys) => {
              const info = SYSTEM_ABBR[sys.id] ?? { short: sys.id.slice(0,2).toUpperCase(), color: "#9ca3af", bg: "#374151" };
              const isActive = activeSystemId === sys.id;
              return (
                <button key={sys.id}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${isActive ? "border-opacity-100 shadow-lg" : "border-gray-700 bg-gray-900 text-gray-400 hover:text-gray-200"}`}
                  style={isActive ? { color: info.color, backgroundColor: info.bg, borderColor: info.color + "88" } : {}}
                  onClick={() => setActiveSystemId(sys.id)}>
                  <span className="font-bold">{info.short}</span>
                  <span>{sys.label}</span>
                </button>
              );
            })}
            <span className="text-gray-700 text-xs ml-2">
              {allTacticalGroups.filter(g => (g.systemId ?? "stanton") === activeSystemId).length} Gruppen
            </span>
          </div>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <SpawnBar spawnGroups={spawnGroups} board={board} playersById={playersById}
              aliveState={aliveState} canWrite={canWrite} onRename={renameGroup}
              onDelete={deleteGroup} onClear={clearGroup} />

            <div className="flex gap-3 items-start overflow-x-auto pb-4">
              {/* Unassigned */}
              <div style={{ width: 220, flexShrink: 0 }}>
                <div className="rounded-t-xl border border-b-0 border-gray-700 bg-gray-900 px-3 py-2">
                  <input className="w-full bg-gray-800 border border-gray-600 text-white text-xs rounded px-2 py-1 mb-2 focus:outline-none focus:border-blue-500"
                    placeholder="🔍 Suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <div className="flex flex-wrap gap-1">
                    {([
                      { f: "name", l: "Name" }, { f: "area", l: "Bereich" }, { f: "role", l: "Rolle" },
                      { f: "squadron", l: "Staffel" }, { f: "homeLocation", l: "Heimatort" }, { f: "aliveStatus", l: "Status" },
                    ] as const).map(({ f, l }) => (
                      <button key={f}
                        className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${sortField === f ? "bg-blue-700 border-blue-500 text-white" : "bg-gray-800 border-gray-600 text-gray-400 hover:text-white"}`}
                        onClick={() => toggleSort(f)}>
                        {l}{sortField === f ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </button>
                    ))}
                    {sortField && (
                      <button className="text-xs px-1.5 py-0.5 rounded border border-gray-700 text-gray-600 hover:text-red-400" onClick={() => setSortField(null)}>✕</button>
                    )}
                  </div>
                </div>
                <div className="rounded-b-xl border border-gray-700 bg-gray-900 overflow-y-auto px-2 py-2 space-y-1" style={{ maxHeight: "calc(100vh - 220px)" }}>
                  <SortableContext items={filteredSortedUnassigned} strategy={rectSortingStrategy}>
                    <UnassignedDrop id="unassigned" label={unassignedGroup.label} count={(board.columns["unassigned"] ?? []).length}>
                      {filteredSortedUnassigned.length === 0 && (
                        <div className="text-xs text-gray-600 border border-dashed border-gray-700 rounded-lg p-3 text-center">
                          {search ? "Keine Treffer" : "leer"}
                        </div>
                      )}
                      {filteredSortedUnassigned.map((pid) =>
                        playersById[pid] ? (
                          <Card key={pid} player={playersById[pid]} aliveState={aliveState}
                            currentPlayerId={currentPlayer.id} canWrite={canWrite} onToggleAlive={toggleAlive}
                            spawnGroups={spawnGroups} spawnState={spawnState} onSetSpawn={setSpawn}
                            groupRoles={groupRoles} groupId="unassigned" onSetRole={setGroupRole}
                            isAdmin={isAdmin} onSetAppRole={setPlayerAppRole}
                            onSetPlayerField={setPlayerField}
                            />
                        ) : null
                      )}
                    </UnassignedDrop>
                  </SortableContext>
                </div>
              </div>

              {/* Tactical groups – SortableContext für Spalten-DnD */}
              <SortableContext items={tacticalGroups.map((g) => g.id)} strategy={rectSortingStrategy}>
                <div className="flex flex-wrap gap-3 flex-1 items-start">
                  {tacticalGroups.map((g) => (
                    <DroppableColumnMemo key={g.id} group={g} ids={board.columns[g.id] ?? []}
                      playersById={playersById} aliveState={aliveState} currentPlayerId={currentPlayer.id}
                      canWrite={canWrite} onToggleAlive={toggleAlive} onRename={renameGroup}
                      onDelete={deleteGroup} onClear={() => clearGroup(g.id)}
                      spawnGroups={spawnGroups} spawnState={spawnState} onSetSpawn={setSpawn}
                      groupRoles={groupRoles} onSetRole={setGroupRole}
                      isAdmin={isAdmin} onSetAppRole={setPlayerAppRole}
                      onSetPlayerField={setPlayerField}
                      onSetColor={setGroupColor} onSetIcon={setGroupIcon}
                      systems={systems}
                                    onSetSystem={(sysId) => setGroupSystem(g.id, sysId)}
/>
                  ))}
                  {canWrite && (
                    <div className="flex flex-col gap-2">
                      <button className="text-xs px-3 py-2 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800 whitespace-nowrap" onClick={() => addGroup(false, activeSystemId)}>+ Gruppe</button>
                      <button className="text-xs px-3 py-2 rounded-xl border border-yellow-800 text-yellow-400 hover:bg-yellow-950 whitespace-nowrap" onClick={() => addGroup(true, activeSystemId)}>⚓ Spawn</button>
                    </div>
                  )}
                </div>
              </SortableContext>
            </div>
          </DndContext>
          </div>

      {/* Floating Panels – sichtbar auf Board UND Karte */}
      {notesVisible && (
        <NotesPanel x={localPanelPos.notes.x} y={localPanelPos.notes.y}
          w={localPanelPos.notes.w} h={localPanelPos.notes.h}
          text={notesText} onChange={handleNotesChange}
          onMove={movePanelNotes} onResize={resizePanelNotes}
          canWrite={canWrite}
          systemText={systemNotesTexts[activeSystemId] ?? ""}
          onSystemChange={(t) => handleSystemNotesChange(activeSystemId, t)}
          systemLabel={systems.find(s=>s.id===activeSystemId)?.label ?? activeSystemId}
          minimized={minimizedPanels["notes"]}
          onToggleMinimize={() => toggleMinPanel("notes")} />
      )}
      {localPanelPos.logNotes.visible && (
        <LogNotesPanel
          x={localPanelPos.logNotes.x} y={localPanelPos.logNotes.y}
          w={localPanelPos.logNotes.w} h={localPanelPos.logNotes.h}
          visible={true}
          entries={logEntries}
          onAdd={handleAddLogEntry}
          onClear={handleClearLogEntries}
          onMove={movePanelLogNotes}
          onResize={resizePanelLogNotes}
          canWrite={canWrite}
          minimized={minimizedPanels["log"]}
          onToggleMinimize={() => toggleMinPanel("log")}
        />
      )}

      {localPanelPos.opLog.visible && (
        <OpLogPanel
          x={localPanelPos.opLog.x} y={localPanelPos.opLog.y}
          w={localPanelPos.opLog.w} h={localPanelPos.opLog.h}
          visible={true}
          entries={opLogEntries}
          onClear={handleClearOpLog}
          onToggleActive={handleToggleOpLog}
          isActive={opLogActive}
          canWrite={canWrite}
          onMove={movePanelOpLog}
          onResize={resizePanelOpLog}
          isAdmin={isAdmin}
          systems={systems}
          minimized={minimizedPanels["oplog"]}
          onToggleMinimize={() => toggleMinPanel("oplog")}
        />
      )}

      {/* MAP – Block 3: display:none statt Unmount */}
      <div className="flex-1 relative flex flex-col"
        style={{ display: tab === "map" ? "flex" : "none" }}>
          {/* System-Tabs auf der Karte */}
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-950 border-b border-gray-800 flex-shrink-0 z-30">
            {systems.map((sys) => {
              const info = SYSTEM_ABBR[sys.id] ?? { short: sys.id.slice(0,2).toUpperCase(), color: "#9ca3af", bg: "#374151" };
              const isActive = activeSystemId === sys.id;
              return (
                <button key={sys.id}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-xl border text-xs font-semibold transition-all ${isActive ? "border-opacity-100 shadow-lg" : "border-gray-700 bg-gray-900 text-gray-400 hover:text-gray-200"}`}
                  style={isActive ? { color: info.color, backgroundColor: info.bg, borderColor: info.color + "88" } : {}}
                  onClick={() => { setActiveSystemId(sys.id); }}>
                  <span>{info.short}</span>
                  <span>{sys.label}</span>
                </button>
              );
            })}
            {/* Breadcrumb */}
            <div className="ml-3 flex items-center gap-1 text-sm">
              {breadcrumb.map((b, i) => (
                <React.Fragment key={b.id}>
                  {i > 0 && <span className="text-gray-600">›</span>}
                  <button className={`hover:text-white ${i === breadcrumb.length - 1 ? "text-white" : "text-gray-400"}`} onClick={() => setActiveMapId(b.id)}>
                    {b.label}
                  </button>
                </React.Fragment>
              ))}
              {isAdmin && <span className="text-yellow-600 text-xs ml-2">✥</span>}
            </div>
          </div>
          <div className="flex-1 relative">
            <div className="absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
            {!activeImage ? (
              <AutoMap label={activeLabel} mapId={activeMapId} />
            ) : (
              <ZoomableMap imageSrc={activeImage} tokens={tokens} groups={board.groups} board={board}
                playersById={playersById} aliveState={aliveState} groupRoles={groupRoles}
                onMoveTokenLocal={moveTokenLocal} onCommitToken={commitToken}
                canWriteTokens={canWrite && drawTool === "pointer"}
                markers={markersOnActive}
                onOpenMarker={(id) => setActiveMapId(id)} onCommitMarker={handleCommitMarker}
                activeMapId={activeMapId} onRemoveToken={removeToken} onMoveTokenUp={moveTokenUp}
                getActiveGroupsForMarker={getActiveGroupsForMarker}
                    isAdmin={isAdmin}
                    orderMarkers={orderMarkers}
                onMoveOrderMarkerLocal={moveOrderMarkerLocal}
                onCommitOrderMarker={upsertOrderMarker}
                onRemoveOrderMarker={removeOrderMarker}
                drawElements={drawings[activeMapId] ?? []}
                drawTool={drawTool} drawColor={drawColor} drawWidth={drawWidth}
                canDraw={canWrite}
                onAddDrawElement={addDrawElement}
                onRemoveDrawElement={removeDrawElement}
                onUpdateDrawElement={updateDrawElement}
                showGrid={showGrid}
                onScaleChange={handleScaleChange}
                onResetDrawTool={() => setDrawTool("pointer")}
              />
            )}
          </div>

          {/* Zoom/Pan Reset Button */}
          {activeImage && (mapScale !== 1) && (
            <button
              className="absolute bottom-3 right-3 z-40 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-900 bg-opacity-80 border border-gray-600 text-gray-300 text-xs hover:bg-gray-800 hover:text-white transition-colors shadow-lg"
              onClick={() => resetViewRef.current()}
              title="Zoom & Pan zurücksetzen">
              ⊙ Reset
            </button>
          )}

          <MapControlDock
            preferences={mapUiPreferences}
            onPreferencesChange={setMapUiPreferences}
            maps={(
              <div>
                <div className="mb-2 text-xs text-gray-500">
                  {systems.find((system) => system.id === activeSystemId)?.label ?? activeSystemId}
                </div>
                <MapNavPanel maps={displayMaps} pois={pois} activeMapId={activeMapId} setActiveMapId={setActiveMapId}
                  isAdmin={isAdmin} onRenameMap={renameMap} onDeleteMap={deleteMap} onAddSubmap={addSubmap}
                  onRenamePOI={renamePOI} onDeletePOI={deletePOI} onAddPOI={addPOI} onSetMapImage={setMapImage}
                  onReorderMaps={reorderMaps} onReorderPOIs={reorderPOIs} />
              </div>
            )}
            tokens={canWrite ? (
              <TokenPlacerPanel groups={tacticalGroups}
                onPlace={(gId, x, y, mapId) => upsertToken(gId, x, y, mapId)}
                onPlaceOrder={(gId, x, y, mapId) => upsertOrderMarker(gId, x, y, mapId)}
                activeMapId={activeMapId} />
            ) : null}
            drawing={activeImage && canWrite ? (
              <DrawingToolbar
                tool={drawTool} setTool={setDrawTool}
                color={drawColor} setColor={setDrawColor}
                width={drawWidth} setWidth={setDrawWidth}
                canDraw={canWrite}
                onUndo={undoDrawElement}
                onClear={clearDrawings}
              />
            ) : null}
          />

          </div>
        </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// UNASSIGNED DROP
// ─────────────────────────────────────────────────────────────

function UnassignedDrop({ id, label, count, children }: { id: string; label: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`min-h-[80px] rounded-lg transition-colors ${isOver ? "bg-blue-950" : ""}`}>
      <div className="text-xs text-gray-500 font-semibold mb-2 px-1">{label} <span className="text-gray-600">({count})</span></div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">Laden…</div></div>}>
      <BoardApp />
    </Suspense>
  );
}
