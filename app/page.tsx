"use client";

import React, {
  useCallback, useEffect, useMemo, useRef, useState, Suspense,
} from "react";
import Papa from "papaparse";
import {
  DndContext, DragEndEvent, PointerSensor,
  useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSearchParams } from "next/navigation";
import { db, auth } from "@/lib/firebase";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut, User,
} from "firebase/auth";

// ─────────────────────────────────────────────────────────────
// TYPEN
// ─────────────────────────────────────────────────────────────

type Player = {
  id: string; name: string; area?: string; role?: string;
  squadron?: string; status?: string; ampel?: string;
  appRole?: string; homeLocation?: string;
};

type Group = { id: string; label: string; isSpawn?: boolean; };

type BoardState = { groups: Group[]; columns: Record<string, string[]>; };

type Token = { groupId: string; x: number; y: number; mapId?: string; };

// Karte (Hauptkarte oder Unterkarte)
type MapEntry = {
  id: string;
  label: string;
  image: string;       // Pfad oder leer
  parentId?: string;   // undefined = Hauptkarte, string = Unterkarte
  x?: number;          // Position des Markers auf der Elternkarte
  y?: number;
};

// POI (Point of Interest – Unterunterkarte)
type POI = {
  id: string;
  label: string;
  image: string;
  parentMapId: string; // Welcher Unterkarte zugeordnet
  x?: number;
  y?: number;
};

type PlayerAliveState  = Record<string, "alive" | "dead">;
type PlayerSpawnState  = Record<string, string>; // playerId → spawnGroupId
type Role = "admin" | "commander" | "viewer";

const SHEET_CSV_URL = process.env.NEXT_PUBLIC_SHEET_CSV_URL ?? "";
const TEAM_PASSWORD = process.env.NEXT_PUBLIC_TEAM_PASSWORD ?? "";

const DEFAULT_GROUPS: Group[] = [
  { id: "unassigned", label: "Unzugeteilt" },
  { id: "g1", label: "Marines" },
  { id: "g2", label: "Air" },
  { id: "g3", label: "Subradar" },
  { id: "spawn1", label: "Spawn", isSpawn: true },
];

const DEFAULT_MAPS: MapEntry[] = [
  { id: "main", label: "Pyro System", image: "/pyro-map.png" },
];

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function nameToFakeEmail(n: string) {
  return `${n.toLowerCase().replace(/[^a-z0-9]/g, "")}@tcs.internal`;
}
function ampelColor(a?: string) {
  if (a === "gut") return "#16a34a";
  if (a === "mittel") return "#ca8a04";
  return "#dc2626";
}
function uid() { return Math.random().toString(36).slice(2, 9); }

function safeBoard(data: any, groups: Group[]): BoardState {
  const cols: Record<string, string[]> = {};
  for (const g of groups) cols[g.id] = Array.isArray(data?.columns?.[g.id]) ? data.columns[g.id] : [];
  return { groups, columns: cols };
}

// ─────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────

let cachedPlayers: Player[] = [];
async function loadPlayers(): Promise<Player[]> {
  if (cachedPlayers.length > 0) return cachedPlayers;
  if (!SHEET_CSV_URL.startsWith("http")) return [];
  const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const list: Player[] = [];
  (parsed.data as any[]).forEach((row, idx) => {
    const name = (row["Spielername"] ?? row["Name"] ?? "").toString().trim();
    if (!name) return;
    list.push({
      id: row["PlayerId"]?.toString().trim() || `p_${idx}_${name.replace(/\s+/g, "_")}`,
      name,
      area: (row["Bereich"] ?? "").toString(),
      role: (row["Rolle"] ?? "").toString(),
      squadron: (row["Staffel"] ?? "").toString(),
      status: (row["Status"] ?? "").toString(),
      ampel: (row["Ampel"] ?? "").toString(),
      appRole: (row["AppRolle"] ?? "viewer").toString().toLowerCase(),
      homeLocation: (row["Heimatort"] ?? "").toString(),
    });
  });
  cachedPlayers = list;
  return list;
}

// ─────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────

function LoginView({ onLogin }: { onLogin: (p: Player) => void }) {
  const [playerName, setPlayerName] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setMsg(""); setLoading(true);
    try {
      if (password !== TEAM_PASSWORD) { setMsg("Falsches Team-Passwort."); setLoading(false); return; }
      const players = await loadPlayers();
      const found = players.find(p => p.name.toLowerCase() === playerName.trim().toLowerCase());
      if (!found) { setMsg(`"${playerName}" nicht gefunden.`); setLoading(false); return; }
      const email = nameToFakeEmail(found.name);
      const pw = TEAM_PASSWORD + "_tcs_internal";
      try { await signInWithEmailAndPassword(auth, email, pw); }
      catch { await createUserWithEmailAndPassword(auth, email, pw); }
      onLogin(found);
    } catch (e: any) { setMsg(e?.message ?? "Fehler."); }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-sm shadow-xl">
        <h1 className="font-bold text-xl mb-1 text-white">Tactical Command Suite</h1>
        <p className="text-gray-400 text-sm mb-6">Pyro Operations Board</p>
        <label className="text-gray-300 text-xs mb-1 block">Spielername</label>
        <input className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-3 text-sm focus:outline-none focus:border-blue-500"
          placeholder="z.B. KRT_Bjoern" value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <label className="text-gray-300 text-xs mb-1 block">Team-Passwort</label>
        <input className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-5 text-sm focus:outline-none focus:border-blue-500"
          type="password" placeholder="Team-Passwort" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <button className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          onClick={handleLogin} disabled={loading || !playerName || !password}>
          {loading ? "Einloggen..." : "Einloggen"}
        </button>
        {msg && <p className="mt-3 text-red-400 text-xs">{msg}</p>}
        <p className="mt-4 text-gray-600 text-xs text-center">Spielername exakt wie im Sheet.</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// INLINE EDIT
// ─────────────────────────────────────────────────────────────

function InlineEdit({ value, onSave, className = "" }: { value: string; onSave: (v: string) => void; className?: string; }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  function commit() { if (draft.trim()) onSave(draft.trim()); setEditing(false); }
  if (editing) return (
    <input className={`bg-gray-700 border border-gray-500 text-white rounded px-1 text-sm focus:outline-none ${className}`}
      value={draft} autoFocus
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      onClick={e => e.stopPropagation()} />
  );
  return (
    <span className={`cursor-text hover:text-blue-300 ${className}`}
      onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true); }}
      title="Klicken zum Umbenennen">
      {value} <span className="text-gray-600 text-xs">✎</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// SPIELER-KARTE
// ─────────────────────────────────────────────────────────────

function Card({
  player, aliveState, currentPlayerId, canWrite,
  onToggleAlive, spawnGroups, spawnState, onSetSpawn,
}: {
  player: Player;
  aliveState: PlayerAliveState;
  currentPlayerId: string;
  canWrite: boolean;
  onToggleAlive: (id: string) => void;
  spawnGroups: Group[];
  spawnState: PlayerSpawnState;
  onSetSpawn: (playerId: string, spawnId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: player.id });

  const isDead = aliveState[player.id] === "dead";
  const isSelf = player.id === currentPlayerId;
  // Commander/Admin können auch andere als tot markieren
  const canToggle = isSelf || canWrite;
  const playerSpawn = spawnState[player.id] ?? "";

  return (
    <div ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={`rounded-xl border p-2 shadow-sm cursor-grab active:cursor-grabbing transition-all
        ${isDead ? "bg-gray-900 border-red-900 opacity-70" : "bg-gray-800 border-gray-700"}`}
      {...attributes} {...listeners}
    >
      <div style={{ borderLeft: `3px solid ${ampelColor(player.ampel)}`, paddingLeft: 6 }}>
        <div className="flex items-center justify-between gap-1">
          <div className={`font-semibold text-sm truncate ${isDead ? "line-through text-gray-500" : "text-white"}`}>
            {player.name}
          </div>
          {canToggle && (
            <button
              className={`text-xs px-1.5 py-0.5 rounded border transition-colors flex-shrink-0
                ${isDead ? "bg-red-950 border-red-700 text-red-400 hover:bg-red-900"
                         : "bg-green-950 border-green-700 text-green-400 hover:bg-green-900"}`}
              onClick={e => { e.stopPropagation(); onToggleAlive(player.id); }}>
              {isDead ? "☠" : "✓"}
            </button>
          )}
          {!canToggle && isDead && <span className="text-xs text-red-500 flex-shrink-0">☠</span>}
        </div>
        <div className="text-xs text-gray-400 truncate">
          {player.area}{player.role ? ` · ${player.role}` : ""}
          {player.homeLocation ? ` · 📍${player.homeLocation}` : ""}
        </div>
        {/* Spawn-Dropdown – nur für den Spieler selbst */}
        {isSelf && spawnGroups.length > 0 && (
          <select
            className="mt-1 w-full bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded px-1 py-0.5 focus:outline-none"
            value={playerSpawn}
            onChange={e => { e.stopPropagation(); onSetSpawn(player.id, e.target.value); }}
            onClick={e => e.stopPropagation()}
          >
            <option value="">Spawn wählen…</option>
            {spawnGroups.map(sg => (
              <option key={sg.id} value={sg.id}>{sg.label}</option>
            ))}
          </select>
        )}
        {/* Für andere: gewählten Spawn anzeigen */}
        {!isSelf && playerSpawn && (
          <div className="text-xs text-yellow-600 mt-0.5">
            ⚓ {spawnGroups.find(sg => sg.id === playerSpawn)?.label ?? ""}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GRUPPE
// ─────────────────────────────────────────────────────────────

function DroppableColumn({
  group, ids, playersById, aliveState, currentPlayerId,
  canWrite, onToggleAlive, onRename, onDelete, onClear,
  spawnGroups, spawnState, onSetSpawn,
}: {
  group: Group; ids: string[];
  playersById: Record<string, Player>;
  aliveState: PlayerAliveState;
  currentPlayerId: string;
  canWrite: boolean;
  onToggleAlive: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onClear?: () => void;
  spawnGroups: Group[];
  spawnState: PlayerSpawnState;
  onSetSpawn: (playerId: string, spawnId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  const safeIds = ids ?? [];
  const deadCount = safeIds.filter(pid => aliveState[pid] === "dead").length;
  const isSystem = group.id === "unassigned";

  return (
    <div ref={setNodeRef}
      className={`rounded-xl border p-3 shadow-sm min-h-[180px] transition-colors flex flex-col
        ${group.isSpawn ? "border-yellow-700 bg-gray-900" : isOver ? "bg-gray-700 border-blue-500" : "bg-gray-900 border-gray-700"}`}>
      <div className="flex items-center justify-between mb-2 gap-1">
        <div className={`font-semibold text-sm flex items-center gap-1 flex-1 min-w-0
          ${group.isSpawn ? "text-yellow-400" : "text-white"}`}>
          {group.isSpawn && <span>⚓</span>}
          {canWrite && !isSystem
            ? <InlineEdit value={group.label} onSave={v => onRename(group.id, v)} className="flex-1" />
            : <span className="truncate">{group.label}</span>
          }
          <span className="text-gray-500 font-normal text-xs flex-shrink-0">({safeIds.length})</span>
          {deadCount > 0 && <span className="text-red-500 text-xs flex-shrink-0">☠{deadCount}</span>}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {onClear && canWrite && (
            <button className="text-xs text-gray-600 hover:text-yellow-400 px-1" onClick={onClear} title="Leeren">↩</button>
          )}
          {canWrite && !isSystem && (
            <button className="text-xs text-gray-600 hover:text-red-500 px-1" onClick={() => onDelete(group.id)} title="Löschen">✕</button>
          )}
        </div>
      </div>
      <SortableContext items={safeIds} strategy={rectSortingStrategy}>
        <div className="space-y-1 flex-1">
          {safeIds.length === 0 && (
            <div className="text-xs text-gray-600 border border-dashed border-gray-700 rounded-lg p-3 text-center">
              {group.isSpawn ? "Spawn-Bereich" : "hierher ziehen"}
            </div>
          )}
          {safeIds.map(pid => playersById[pid] ? (
            <Card key={pid} player={playersById[pid]}
              aliveState={aliveState} currentPlayerId={currentPlayerId}
              canWrite={canWrite} onToggleAlive={onToggleAlive}
              spawnGroups={spawnGroups} spawnState={spawnState} onSetSpawn={onSetSpawn} />
          ) : null)}
        </div>
      </SortableContext>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// KARTEN-SIDEBAR NAV
// ─────────────────────────────────────────────────────────────

function MapNav({
  maps, pois, activeMapId, setActiveMapId, isAdmin,
  onRenameMap, onDeleteMap, onAddSubmap,
  onRenamePOI, onDeletePOI, onAddPOI,
  onAddMapImage,
}: {
  maps: MapEntry[];
  pois: POI[];
  activeMapId: string;
  setActiveMapId: (id: string) => void;
  isAdmin: boolean;
  onRenameMap: (id: string, label: string) => void;
  onDeleteMap: (id: string) => void;
  onAddSubmap: () => void;
  onRenamePOI: (id: string, label: string) => void;
  onDeletePOI: (id: string) => void;
  onAddPOI: (parentMapId: string) => void;
  onAddMapImage: (id: string, image: string) => void;
}) {
  const mainMap   = maps.find(m => m.id === "main")!;
  const submaps   = maps.filter(m => m.id !== "main" && !m.parentId);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
      <div className="font-semibold text-sm text-white mb-2">Karten</div>

      {/* Hauptkarte */}
      <MapNavItem
        label={mainMap?.label ?? "Pyro System"}
        mapId="main"
        activeMapId={activeMapId}
        setActiveMapId={setActiveMapId}
        isAdmin={isAdmin}
        canEdit={false}
        canDelete={false}
        indent={0}
        onRename={v => onRenameMap("main", v)}
        onDelete={() => {}}
        onAddImage={img => onAddMapImage("main", img)}
        currentImage={mainMap?.image ?? ""}
      />

      {/* Unterkarten */}
      {submaps.map(sm => {
        const smPois = pois.filter(p => p.parentMapId === sm.id);
        return (
          <React.Fragment key={sm.id}>
            <MapNavItem
              label={sm.label}
              mapId={sm.id}
              activeMapId={activeMapId}
              setActiveMapId={setActiveMapId}
              isAdmin={isAdmin}
              canEdit={isAdmin}
              canDelete={isAdmin}
              indent={1}
              onRename={v => onRenameMap(sm.id, v)}
              onDelete={() => onDeleteMap(sm.id)}
              onAddImage={img => onAddMapImage(sm.id, img)}
              currentImage={sm.image}
            />
            {/* POIs dieser Unterkarte */}
            {smPois.map(poi => (
              <MapNavItem
                key={poi.id}
                label={poi.label}
                mapId={poi.id}
                activeMapId={activeMapId}
                setActiveMapId={setActiveMapId}
                isAdmin={isAdmin}
                canEdit={isAdmin}
                canDelete={isAdmin}
                indent={2}
                isPOI
                onRename={v => onRenamePOI(poi.id, v)}
                onDelete={() => onDeletePOI(poi.id)}
                onAddImage={img => onAddMapImage(poi.id, img)}
                currentImage={poi.image}
              />
            ))}
            {/* POI hinzufügen */}
            {isAdmin && (
              <button
                className="block ml-12 mt-0.5 mb-1 text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-600 hover:text-gray-300 hover:bg-gray-800"
                onClick={() => onAddPOI(sm.id)}>
                + POI hinzufügen
              </button>
            )}
          </React.Fragment>
        );
      })}

      {/* Unterkarte hinzufügen */}
      {isAdmin && (
        <button
          className="mt-1 text-xs px-2 py-1 rounded-lg border border-gray-700 text-gray-500 hover:text-gray-300 hover:bg-gray-800 w-full"
          onClick={onAddSubmap}>
          + Unterkarte hinzufügen
        </button>
      )}
    </div>
  );
}

function MapNavItem({
  label, mapId, activeMapId, setActiveMapId, isAdmin,
  canEdit, canDelete, indent, isPOI,
  onRename, onDelete, onAddImage, currentImage,
}: {
  label: string; mapId: string; activeMapId: string;
  setActiveMapId: (id: string) => void;
  isAdmin: boolean; canEdit: boolean; canDelete: boolean;
  indent: number; isPOI?: boolean;
  onRename: (v: string) => void; onDelete: () => void;
  onAddImage: (img: string) => void; currentImage: string;
}) {
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageDraft, setImageDraft] = useState(currentImage);
  const isActive = activeMapId === mapId;
  const ml = indent === 0 ? "" : indent === 1 ? "ml-4" : "ml-9";
  const icon = indent === 0 ? "🗺" : isPOI ? "🔵" : "📍";

  return (
    <div className={`${ml} mb-1`}>
      <div className="flex items-center gap-1">
        {indent > 0 && <div className="w-3 h-px bg-gray-700 flex-shrink-0" />}
        <button
          className={`flex-1 rounded-lg border px-2 py-1.5 text-left transition-colors min-w-0
            ${isActive ? "bg-blue-900 border-blue-600 text-blue-200" : "bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-gray-200"}
            ${indent === 0 ? "text-sm" : "text-xs"}`}
          onClick={() => setActiveMapId(mapId)}>
          <span className="flex items-center gap-1 min-w-0">
            <span>{icon}</span>
            {canEdit
              ? <InlineEdit value={label} onSave={onRename} className="flex-1 min-w-0" />
              : <span className="truncate">{label}</span>
            }
          </span>
        </button>
        {isAdmin && (
          <button
            className="text-xs text-gray-700 hover:text-blue-400 px-1 flex-shrink-0"
            title="Kartenbild setzen"
            onClick={() => setShowImageInput(v => !v)}>
            🖼
          </button>
        )}
        {canDelete && (
          <button className="text-xs text-gray-700 hover:text-red-500 px-1 flex-shrink-0" onClick={onDelete}>✕</button>
        )}
      </div>
      {/* Kartenbild-Eingabe */}
      {showImageInput && isAdmin && (
        <div className={`${ml} mt-1 flex gap-1`}>
          <input
            className="flex-1 bg-gray-800 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:outline-none"
            placeholder="/maps/dateiname.png"
            value={imageDraft}
            onChange={e => setImageDraft(e.target.value)}
          />
          <button
            className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 rounded"
            onClick={() => { onAddImage(imageDraft); setShowImageInput(false); }}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ZOOMBARE KARTE
// ─────────────────────────────────────────────────────────────

function ZoomableMap({
  imageSrc, tokens, groups, onMoveToken, canMove, isAdmin,
  markers, onOpenMarker, onMoveMarker, activeMapId,
}: {
  imageSrc: string;
  tokens: Token[];
  groups: Group[];
  onMoveToken: (groupId: string, x: number, y: number) => void;
  canMove: boolean; // alle dürfen Viewport verschieben
  isAdmin: boolean;
  markers: Array<{ id: string; label: string; x: number; y: number; isPOI?: boolean }>;
  onOpenMarker: (id: string) => void;
  onMoveMarker: (id: string, x: number, y: number) => void;
  activeMapId: string;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [tokenDrag, setTokenDrag] = useState<string | null>(null);
  const [markerDrag, setMarkerDrag] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  function getMapCoords(e: React.PointerEvent) {
    const img = document.getElementById("map-img");
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale(s => Math.max(0.3, Math.min(8, s * (e.deltaY > 0 ? 0.9 : 1.1))));
  }

  function onBgDown(e: React.PointerEvent) {
    if (tokenDrag || markerDrag) return;
    setPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onBgMove(e: React.PointerEvent) {
    if (panning && !tokenDrag && !markerDrag) {
      setOffset({ x: panStart.current.ox + e.clientX - panStart.current.x, y: panStart.current.oy + e.clientY - panStart.current.y });
    }
    if (tokenDrag) { const c = getMapCoords(e); if (c) onMoveToken(tokenDrag, c.x, c.y); }
    if (markerDrag) { const c = getMapCoords(e); if (c) onMoveMarker(markerDrag, c.x, c.y); }
  }

  function onBgUp() { setPanning(false); setTokenDrag(null); setMarkerDrag(null); }

  const visibleTokens = tokens.filter(t => activeMapId === "main" ? !t.mapId : t.mapId === activeMapId);
  const groupLabel = (gId: string) => groups.find(g => g.id === gId)?.label ?? gId;

  return (
    <div className="relative rounded-xl border border-gray-700 overflow-hidden bg-gray-950"
      style={{ height: 860 }}>
      {/* Zoom-Buttons */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
        {[
          { lbl: "+", fn: () => setScale(s => Math.min(8, s * 1.3)) },
          { lbl: "−", fn: () => setScale(s => Math.max(0.3, s / 1.3)) },
          { lbl: "⊙", fn: () => { setScale(1); setOffset({ x: 0, y: 0 }); } },
        ].map(b => (
          <button key={b.lbl} onClick={b.fn}
            className="w-8 h-8 bg-gray-800 border border-gray-600 text-white rounded-lg text-sm font-bold hover:bg-gray-700">
            {b.lbl}
          </button>
        ))}
      </div>

      <div className="w-full h-full overflow-hidden"
        style={{ cursor: panning ? "grabbing" : "grab" }}
        onWheel={onWheel} onPointerDown={onBgDown} onPointerMove={onBgMove} onPointerUp={onBgUp}>
        <div style={{
          transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: (panning || tokenDrag || markerDrag) ? "none" : "transform 0.1s",
          width: "100%", height: "100%", position: "relative",
        }}>
          <img id="map-img" src={imageSrc} alt="Map"
            className="w-full h-full object-contain block select-none" draggable={false} />

          {/* Karten-Marker (Unterkarten / POIs) */}
          {markers.map(m => (
            <div key={m.id}
              className={`absolute z-10 flex items-center gap-1
                ${isAdmin ? "cursor-move" : "cursor-pointer"}`}
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: "translate(-50%,-50%)" }}
              onPointerDown={e => { e.stopPropagation(); if (isAdmin) setMarkerDrag(m.id); }}
              onClick={e => { e.stopPropagation(); if (!markerDrag) onOpenMarker(m.id); }}
            >
              <div className={`text-xs font-bold px-2 py-0.5 rounded-full border-2 shadow-lg select-none whitespace-nowrap
                ${m.isPOI
                  ? "bg-blue-700 border-blue-400 text-white"
                  : "bg-yellow-500 border-yellow-300 text-black"}`}>
                {m.isPOI ? "🔵" : "📍"} {m.label}
              </div>
              {isAdmin && <span className="text-yellow-400 text-xs opacity-50">✥</span>}
            </div>
          ))}

          {/* Gruppen-Tokens – mit Gruppenname */}
          {visibleTokens.map(t => (
            <div key={t.groupId}
              className={`absolute z-10 rounded-full border-2 border-white bg-blue-600 text-white
                px-2 py-0.5 text-xs font-bold shadow-lg select-none whitespace-nowrap
                ${canMove ? "cursor-grab active:cursor-grabbing" : "cursor-default"}
                ${tokenDrag === t.groupId ? "ring-2 ring-yellow-400 scale-110" : ""}`}
              style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, transform: "translate(-50%,-50%)" }}
              onPointerDown={e => { if (!canMove) return; e.stopPropagation(); setTokenDrag(t.groupId); }}>
              {groupLabel(t.groupId)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AUTO-KARTE
// ─────────────────────────────────────────────────────────────

function AutoMap({ label, mapId, isPOI }: { label: string; mapId: string; isPOI?: boolean }) {
  return (
    <div className="w-full bg-gray-800 rounded-xl border border-gray-600 flex items-center justify-center flex-col gap-3 p-8"
      style={{ height: 860 }}>
      <div className="text-gray-300 text-base font-medium">{label}</div>
      <div className="text-gray-500 text-sm text-center">
        Kein Kartenbild vorhanden.<br />
        Klicke auf 🖼 neben dem Eintrag links um ein Bild zu setzen.<br />
        <code className="text-blue-400 text-xs">Pfad z.B.: /maps/{mapId}.png</code>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TOKEN-PLACER
// ─────────────────────────────────────────────────────────────

function MapPlacer({ groups, onPlace, activeMapId }: {
  groups: Group[];
  onPlace: (gId: string, x: number, y: number, mapId: string) => void;
  activeMapId: string;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  const tactical = groups.filter(g => g.id !== "unassigned" && !g.isSpawn);

  useEffect(() => {
    function handler(ev: MouseEvent) {
      const el = document.getElementById("map-img");
      if (!el || !armed) return;
      const rect = el.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) { onPlace(armed, x, y, activeMapId); setArmed(null); }
    }
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [armed, onPlace, activeMapId]);

  return (
    <div>
      <div className="text-xs text-gray-500 mb-2">Token setzen auf aktueller Karte</div>
      {tactical.map(g => (
        <button key={g.id}
          className={`w-full rounded-lg border px-3 py-1.5 mb-1 text-xs font-medium transition-colors
            ${armed === g.id ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"}`}
          onClick={e => { e.stopPropagation(); setArmed(g.id); }}>
          {armed === g.id ? `▶ Klick auf Karte…` : `Setze: ${g.label}`}
        </button>
      ))}
      {armed && (
        <button className="w-full rounded-lg border border-red-800 px-3 py-1.5 text-xs bg-red-950 text-red-400"
          onClick={e => { e.stopPropagation(); setArmed(null); }}>Abbrechen</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// HAUPT-APP
// ─────────────────────────────────────────────────────────────

function BoardApp() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room") || "default";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  const [players, setPlayers] = useState<Player[]>([]);
  const [board, setBoard] = useState<BoardState>({
    groups: DEFAULT_GROUPS,
    columns: Object.fromEntries(DEFAULT_GROUPS.map(g => [g.id, []])),
  });
  const [tokens, setTokens] = useState<Token[]>([]);
  const [aliveState, setAliveState] = useState<PlayerAliveState>({});
  const [spawnState, setSpawnState] = useState<PlayerSpawnState>({});
  const [maps, setMaps] = useState<MapEntry[]>(DEFAULT_MAPS);
  const [pois, setPois] = useState<POI[]>([]);
  const [tab, setTab] = useState<"board" | "map">("board");
  const [activeMapId, setActiveMapId] = useState("main");

  const playersById = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players]);
  const canWrite = role === "admin" || role === "commander";
  const isAdmin = role === "admin";

  // ── Auth ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setAuthReady(true); });
    return () => unsub();
  }, []);

  // ── CSV ──
  useEffect(() => {
    loadPlayers().then(list => {
      setPlayers(list);
      setBoard(prev => {
        const all = new Set(Object.values(prev.columns).flat());
        const toAdd = list.map(p => p.id).filter(id => !all.has(id));
        if (!toAdd.length) return prev;
        return { ...prev, columns: { ...prev.columns, unassigned: [...(prev.columns.unassigned ?? []), ...toAdd] } };
      });
    });
  }, []);

  // ── Rolle ──
  useEffect(() => {
    if (!user || !currentPlayer) return;
    const sheetRole = (currentPlayer.appRole ?? "viewer") as Role;
    setRole(sheetRole);
    setDoc(doc(db, "rooms", roomId, "members", user.uid), { role: sheetRole, name: currentPlayer.name }, { merge: true }).catch(console.error);
  }, [user, currentPlayer, roomId]);

  // ── Firestore Sync ──
  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "rooms", roomId, "state", "board");
    const unsub = onSnapshot(ref, snap => {
      const data = snap.data() as any;
      if (!data) return;
      const loadedGroups: Group[] = Array.isArray(data.groups) && data.groups.length > 0 ? data.groups : DEFAULT_GROUPS;
      setBoard(safeBoard(data, loadedGroups));
      if (data.tokens) setTokens(data.tokens ?? []);
      if (data.aliveState) setAliveState(data.aliveState ?? {});
      if (data.spawnState) setSpawnState(data.spawnState ?? {});
      if (data.maps) setMaps(data.maps.length > 0 ? data.maps : DEFAULT_MAPS);
      if (data.pois) setPois(data.pois ?? []);
    });
    return () => unsub();
  }, [user, roomId]);

  // ── Push ──
  async function pushAll(nb: BoardState, nt: Token[], na: PlayerAliveState, ns: PlayerSpawnState, nm: MapEntry[], np: POI[]) {
    try {
      await setDoc(doc(db, "rooms", roomId, "state", "board"), {
        groups: nb.groups, columns: nb.columns,
        tokens: nt, aliveState: na, spawnState: ns,
        maps: nm, pois: np, updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) { console.error("Firestore:", err); }
  }

  // ── Tot/Lebendig ──
  function toggleAlive(playerId: string) {
    // Spieler selbst ODER Commander/Admin
    if (!currentPlayer) return;
    if (playerId !== currentPlayer.id && !canWrite) return;
    setAliveState(prev => {
      const wasDead = prev[playerId] === "dead";
      const next = { ...prev, [playerId]: wasDead ? "alive" : "dead" } as PlayerAliveState;
      let nextBoard = board;
      if (!wasDead) {
        const playerSpawnId = spawnState[playerId];
        const targetSpawn = playerSpawnId
          ? board.groups.find(g => g.id === playerSpawnId)
          : board.groups.find(g => g.isSpawn);
        if (targetSpawn) {
          const newCols = { ...board.columns };
          for (const gId of Object.keys(newCols)) newCols[gId] = newCols[gId].filter(id => id !== playerId);
          newCols[targetSpawn.id] = [playerId, ...(newCols[targetSpawn.id] ?? [])];
          nextBoard = { ...board, columns: newCols };
          setBoard(nextBoard);
        }
      }
      pushAll(nextBoard, tokens, next, spawnState, maps, pois);
      return next;
    });
  }

  // ── Spawn setzen ──
  function setSpawn(playerId: string, spawnId: string) {
    const next = { ...spawnState, [playerId]: spawnId };
    setSpawnState(next);
    pushAll(board, tokens, aliveState, next, maps, pois);
  }

  // ── Gruppen ──
  function addGroup(isSpawn = false) {
    if (!canWrite) return;
    const g: Group = { id: uid(), label: isSpawn ? "Spawn" : "Neue Gruppe", isSpawn };
    setBoard(prev => {
      const next: BoardState = { groups: [...prev.groups, g], columns: { ...prev.columns, [g.id]: [] } };
      pushAll(next, tokens, aliveState, spawnState, maps, pois);
      return next;
    });
  }

  function renameGroup(id: string, label: string) {
    if (!canWrite) return;
    setBoard(prev => {
      const next = { ...prev, groups: prev.groups.map(g => g.id === id ? { ...g, label } : g) };
      pushAll(next, tokens, aliveState, spawnState, maps, pois);
      return next;
    });
  }

  function deleteGroup(id: string) {
    if (!canWrite || id === "unassigned") return;
    setBoard(prev => {
      const moved = prev.columns[id] ?? [];
      const newCols = { ...prev.columns };
      delete newCols[id];
      newCols["unassigned"] = [...(newCols["unassigned"] ?? []), ...moved];
      const next: BoardState = { groups: prev.groups.filter(g => g.id !== id), columns: newCols };
      const nt = tokens.filter(t => t.groupId !== id);
      setTokens(nt);
      pushAll(next, nt, aliveState, spawnState, maps, pois);
      return next;
    });
  }

  function clearGroup(id: string) {
    if (!canWrite) return;
    setBoard(prev => {
      const moved = prev.columns[id] ?? [];
      const next: BoardState = { ...prev, columns: { ...prev.columns, unassigned: [...(prev.columns["unassigned"] ?? []), ...moved], [id]: [] } };
      pushAll(next, tokens, aliveState, spawnState, maps, pois);
      return next;
    });
  }

  // ── Karten ──
  function addSubmap() {
    if (!isAdmin) return;
    const m: MapEntry = { id: uid(), label: "Neue Karte", image: "", x: 0.5, y: 0.5 };
    const next = [...maps, m];
    setMaps(next);
    pushAll(board, tokens, aliveState, spawnState, next, pois);
  }

  function renameMap(id: string, label: string) {
    if (!isAdmin) return;
    const next = maps.map(m => m.id === id ? { ...m, label } : m);
    setMaps(next);
    pushAll(board, tokens, aliveState, spawnState, next, pois);
  }

  function deleteMap(id: string) {
    if (!isAdmin || id === "main") return;
    const next = maps.filter(m => m.id !== id);
    const nextPois = pois.filter(p => p.parentMapId !== id);
    setMaps(next);
    setPois(nextPois);
    if (activeMapId === id) setActiveMapId("main");
    pushAll(board, tokens, aliveState, spawnState, next, nextPois);
  }

  function setMapImage(id: string, image: string) {
    if (!isAdmin) return;
    // Könnte Unterkarte oder POI sein
    const inMaps = maps.find(m => m.id === id);
    if (inMaps) {
      const next = maps.map(m => m.id === id ? { ...m, image } : m);
      setMaps(next);
      pushAll(board, tokens, aliveState, spawnState, next, pois);
      return;
    }
    const inPois = pois.find(p => p.id === id);
    if (inPois) {
      const next = pois.map(p => p.id === id ? { ...p, image } : p);
      setPois(next);
      pushAll(board, tokens, aliveState, spawnState, maps, next);
    }
  }

  function moveMapMarker(id: string, x: number, y: number) {
    if (!isAdmin) return;
    const next = maps.map(m => m.id === id ? { ...m, x, y } : m);
    setMaps(next);
    pushAll(board, tokens, aliveState, spawnState, next, pois);
  }

  // ── POIs ──
  function addPOI(parentMapId: string) {
    if (!isAdmin) return;
    const p: POI = { id: uid(), label: "Neuer POI", image: "", parentMapId, x: 0.5, y: 0.5 };
    const next = [...pois, p];
    setPois(next);
    pushAll(board, tokens, aliveState, spawnState, maps, next);
  }

  function renamePOI(id: string, label: string) {
    if (!isAdmin) return;
    const next = pois.map(p => p.id === id ? { ...p, label } : p);
    setPois(next);
    pushAll(board, tokens, aliveState, spawnState, maps, next);
  }

  function deletePOI(id: string) {
    if (!isAdmin) return;
    const next = pois.filter(p => p.id !== id);
    setPois(next);
    if (activeMapId === id) setActiveMapId("main");
    pushAll(board, tokens, aliveState, spawnState, maps, next);
  }

  function movePOIMarker(id: string, x: number, y: number) {
    if (!isAdmin) return;
    const next = pois.map(p => p.id === id ? { ...p, x, y } : p);
    setPois(next);
    pushAll(board, tokens, aliveState, spawnState, maps, next);
  }

  // ── Token ──
  const upsertToken = useCallback((gId: string, x: number, y: number, mapId: string) => {
    setTokens(prev => {
      const resolvedMapId = mapId === "main" ? undefined : mapId;
      const i = prev.findIndex(t => t.groupId === gId && (t.mapId ?? "main") === mapId);
      const next = i === -1
        ? [...prev, { groupId: gId, x, y, mapId: resolvedMapId }]
        : prev.map((t, idx) => idx === i ? { groupId: gId, x, y, mapId: resolvedMapId } : t);
      pushAll(board, next, aliveState, spawnState, maps, pois);
      return next;
    });
  }, [board, aliveState, spawnState, maps, pois]);

  // ── Drag & Drop ──
  function findContainer(playerId: string): string | null {
    for (const [gId, ids] of Object.entries(board.columns)) {
      if ((ids ?? []).includes(playerId)) return gId;
    }
    return null;
  }

  function onDragEnd(e: DragEndEvent) {
    if (!canWrite) return;
    const activeId = e.active.id.toString();
    const overId = e.over?.id?.toString();
    if (!overId) return;
    const from = findContainer(activeId);
    const groupIds = board.groups.map(g => g.id);
    const to = groupIds.includes(overId) ? overId : findContainer(overId);
    if (!from || !to) return;
    if (from === to) {
      const oi = (board.columns[from] ?? []).indexOf(activeId);
      const ni = (board.columns[from] ?? []).indexOf(overId);
      if (oi !== -1 && ni !== -1 && oi !== ni) {
        setBoard(prev => {
          const next = { ...prev, columns: { ...prev.columns, [from]: arrayMove(prev.columns[from] ?? [], oi, ni) } };
          pushAll(next, tokens, aliveState, spawnState, maps, pois);
          return next;
        });
      }
      return;
    }
    setBoard(prev => {
      const next: BoardState = {
        ...prev,
        columns: {
          ...prev.columns,
          [from]: (prev.columns[from] ?? []).filter(x => x !== activeId),
          [to]: [activeId, ...(prev.columns[to] ?? [])],
        },
      };
      pushAll(next, tokens, aliveState, spawnState, maps, pois);
      return next;
    });
  }

  // ── Aktive Karte auflösen ──
  const activeMap    = maps.find(m => m.id === activeMapId);
  const activePOI    = pois.find(p => p.id === activeMapId);
  const activeImage  = activeMap?.image ?? activePOI?.image ?? "";
  const activeLabel  = activeMap?.label ?? activePOI?.label ?? "";
  const activeIsMap  = !!activeMap;

  // Marker auf der aktuellen Karte (Unterkarten oder POIs)
  const markersOnActive = useMemo(() => {
    if (activeMapId === "main") {
      // Alle Unterkarten als Marker
      return maps.filter(m => m.id !== "main").map(m => ({
        id: m.id, label: m.label, x: m.x ?? 0.5, y: m.y ?? 0.5, isPOI: false,
      }));
    }
    // POIs der aktuellen Unterkarte
    return pois.filter(p => p.parentMapId === activeMapId).map(p => ({
      id: p.id, label: p.label, x: p.x ?? 0.5, y: p.y ?? 0.5, isPOI: true,
    }));
  }, [activeMapId, maps, pois]);

  function handleMoveMarker(id: string, x: number, y: number) {
    if (maps.find(m => m.id === id)) moveMapMarker(id, x, y);
    else if (pois.find(p => p.id === id)) movePOIMarker(id, x, y);
  }

  function handleOpenMarker(id: string) { setActiveMapId(id); }

  // Breadcrumb
  const breadcrumb = useMemo(() => {
    if (activeMapId === "main") return [{ id: "main", label: "Pyro System" }];
    const sub = maps.find(m => m.id === activeMapId);
    if (sub) return [{ id: "main", label: "Pyro System" }, { id: sub.id, label: sub.label }];
    const poi = pois.find(p => p.id === activeMapId);
    if (poi) {
      const parent = maps.find(m => m.id === poi.parentMapId);
      return [
        { id: "main", label: "Pyro System" },
        { id: poi.parentMapId, label: parent?.label ?? "Unterkarte" },
        { id: poi.id, label: poi.label },
      ];
    }
    return [{ id: "main", label: "Pyro System" }];
  }, [activeMapId, maps, pois]);

  const selfAlive = currentPlayer ? (aliveState[currentPlayer.id] ?? "alive") : "alive";
  const spawnGroups = board.groups.filter(g => g.isSpawn);
  const tacticalGroups = board.groups.filter(g => g.id !== "unassigned" && !g.isSpawn);

  if (!authReady) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400">Laden...</div>
    </div>
  );

  if (!user || !currentPlayer) return <LoginView onLogin={p => setCurrentPlayer(p)} />;

  const roleBadge =
    role === "admin"     ? "bg-red-900 text-red-300 border border-red-700" :
    role === "commander" ? "bg-blue-900 text-blue-300 border border-blue-700" :
                           "bg-gray-800 text-gray-400 border border-gray-600";

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="sticky top-0 z-30 border-b border-gray-800 bg-gray-900">
        <div className="mx-auto max-w-screen-2xl px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="font-bold text-white">TCS</span>
            <span className="text-xs text-gray-500 font-mono">Room: {roomId}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className={`text-xs px-2 py-1 rounded-lg border font-medium transition-colors
                ${selfAlive === "dead" ? "bg-red-950 border-red-700 text-red-400 hover:bg-red-900" : "bg-green-950 border-green-700 text-green-400 hover:bg-green-900"}`}
              onClick={() => toggleAlive(currentPlayer.id)}>
              {selfAlive === "dead" ? "☠ Du bist tot" : "✓ Du lebst"}
            </button>
            <span className="text-sm text-gray-300">{currentPlayer.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge}`}>{role}</span>
            {(["board", "map"] as const).map(t => (
              <button key={t}
                className={`rounded-lg px-3 py-1.5 text-sm border transition-colors
                  ${tab === t ? "bg-white text-black border-white" : "bg-transparent text-gray-300 border-gray-600 hover:border-gray-400"}`}
                onClick={() => setTab(t)}>
                {t === "board" ? "Board" : "Karte"}
              </button>
            ))}
            <button className="text-xs text-gray-500 hover:text-gray-300"
              onClick={() => { setCurrentPlayer(null); setRole("viewer"); signOut(auth); }}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl px-4 py-6">

        {/* ── BOARD ── */}
        {tab === "board" && (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="space-y-4">
              {/* Taktische Gruppen + Unzugeteilt */}
              <div className="grid gap-4" style={{
                gridTemplateColumns: `200px repeat(${Math.max(1, tacticalGroups.length)}, 1fr)`
              }}>
                <DroppableColumn
                  group={board.groups.find(g => g.id === "unassigned")!}
                  ids={board.columns["unassigned"] ?? []}
                  playersById={playersById} aliveState={aliveState}
                  currentPlayerId={currentPlayer.id} canWrite={canWrite}
                  onToggleAlive={toggleAlive} onRename={renameGroup}
                  onDelete={deleteGroup} spawnGroups={spawnGroups}
                  spawnState={spawnState} onSetSpawn={setSpawn}
                />
                {tacticalGroups.map(g => (
                  <DroppableColumn key={g.id} group={g}
                    ids={board.columns[g.id] ?? []}
                    playersById={playersById} aliveState={aliveState}
                    currentPlayerId={currentPlayer.id} canWrite={canWrite}
                    onToggleAlive={toggleAlive} onRename={renameGroup}
                    onDelete={deleteGroup} onClear={() => clearGroup(g.id)}
                    spawnGroups={spawnGroups} spawnState={spawnState} onSetSpawn={setSpawn}
                  />
                ))}
              </div>

              {canWrite && (
                <div className="flex gap-2 flex-wrap">
                  <button className="text-xs px-3 py-1.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800"
                    onClick={() => addGroup(false)}>+ Gruppe</button>
                  <button className="text-xs px-3 py-1.5 rounded-lg border border-yellow-800 text-yellow-400 hover:bg-yellow-950"
                    onClick={() => addGroup(true)}>⚓ Spawn-Gruppe</button>
                </div>
              )}

              {spawnGroups.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Spawn-Bereiche</div>
                  <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(spawnGroups.length, 4)}, 1fr)` }}>
                    {spawnGroups.map(g => (
                      <DroppableColumn key={g.id} group={g}
                        ids={board.columns[g.id] ?? []}
                        playersById={playersById} aliveState={aliveState}
                        currentPlayerId={currentPlayer.id} canWrite={canWrite}
                        onToggleAlive={toggleAlive} onRename={renameGroup}
                        onDelete={deleteGroup} onClear={() => clearGroup(g.id)}
                        spawnGroups={spawnGroups} spawnState={spawnState} onSetSpawn={setSpawn}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DndContext>
        )}

        {/* ── KARTE ── */}
        {tab === "map" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="space-y-4">
              <MapNav
                maps={maps} pois={pois}
                activeMapId={activeMapId} setActiveMapId={setActiveMapId}
                isAdmin={isAdmin}
                onRenameMap={renameMap} onDeleteMap={deleteMap}
                onAddSubmap={addSubmap}
                onRenamePOI={renamePOI} onDeletePOI={deletePOI}
                onAddPOI={addPOI}
                onAddMapImage={setMapImage}
              />
              {canWrite && (
                <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
                  <MapPlacer groups={board.groups}
                    onPlace={(gId, x, y, mapId) => upsertToken(gId, x, y, mapId)}
                    activeMapId={activeMapId} />
                </div>
              )}
            </div>

            <div className="lg:col-span-3">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 mb-2 text-sm text-gray-400 flex-wrap">
                {breadcrumb.map((b, i) => (
                  <React.Fragment key={b.id}>
                    {i > 0 && <span className="text-gray-600">›</span>}
                    <button
                      className={`hover:text-white ${i === breadcrumb.length - 1 ? "text-white" : ""}`}
                      onClick={() => setActiveMapId(b.id)}>
                      {b.label}
                    </button>
                  </React.Fragment>
                ))}
                {isAdmin && activeMapId === "main" && (
                  <span className="text-yellow-600 text-xs ml-2">✥ Marker verschiebbar</span>
                )}
              </div>

              {!activeImage ? (
                <AutoMap label={activeLabel} mapId={activeMapId} isPOI={!activeIsMap} />
              ) : (
                <ZoomableMap
                  imageSrc={activeImage}
                  tokens={tokens}
                  groups={board.groups}
                  onMoveToken={(gId, x, y) => upsertToken(gId, x, y, activeMapId)}
                  canMove={true}
                  isAdmin={isAdmin}
                  markers={markersOnActive}
                  onOpenMarker={handleOpenMarker}
                  onMoveMarker={handleMoveMarker}
                  activeMapId={activeMapId}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Laden...</div>
      </div>
    }>
      <BoardApp />
    </Suspense>
  );
}
