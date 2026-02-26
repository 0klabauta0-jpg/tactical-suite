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
import {
  doc, onSnapshot, setDoc, serverTimestamp,
} from "firebase/firestore";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut, User,
} from "firebase/auth";

// ─────────────────────────────────────────────────────────────
// TYPEN
// ─────────────────────────────────────────────────────────────

type Player = {
  id: string;
  name: string;
  area?: string;
  role?: string;
  squadron?: string;
  status?: string;
  ampel?: string;
  appRole?: string;
  homeLocation?: string;
};

// Gruppe: id + label + optional spawn-Gruppe
type Group = {
  id: string;
  label: string;
  isSpawn?: boolean; // Spawn-Gruppen nehmen tote Spieler auf
};

type BoardState = {
  groups: Group[];
  columns: Record<string, string[]>; // groupId → playerIds
};

type Token = {
  groupId: string;
  x: number;
  y: number;
  mapId?: string;
};

type SubMap = {
  id: string;
  label: string;
  image: string;
  x: number;
  y: number;
};

type PlayerAliveState = Record<string, "alive" | "dead">;
type Role = "admin" | "commander" | "viewer";

const SHEET_CSV_URL = process.env.NEXT_PUBLIC_SHEET_CSV_URL ?? "";
const TEAM_PASSWORD = process.env.NEXT_PUBLIC_TEAM_PASSWORD ?? "";

// Standard-Gruppen beim ersten Start
const DEFAULT_GROUPS: Group[] = [
  { id: "unassigned", label: "Unzugeteilt" },
  { id: "g1", label: "Marines" },
  { id: "g2", label: "Air" },
  { id: "g3", label: "Subradar" },
  { id: "spawn1", label: "Spawn", isSpawn: true },
];

// Standard-Unterkarten
const DEFAULT_SUBMAPS: SubMap[] = [
  { id: "ruin_station", label: "Ruin Station", image: "", x: 0.55, y: 0.45 },
];

// ─────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────

let cachedPlayers: Player[] = [];

async function loadPlayers(): Promise<Player[]> {
  if (cachedPlayers.length > 0) return cachedPlayers;
  if (!SHEET_CSV_URL.startsWith("http")) return [];
  const res    = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  const text   = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const list: Player[] = [];
  (parsed.data as any[]).forEach((row, idx) => {
    const name = (row["Spielername"] ?? row["Name"] ?? "").toString().trim();
    if (!name) return;
    list.push({
      id:           row["PlayerId"]?.toString().trim() || `p_${idx}_${name.replace(/\s+/g, "_")}`,
      name,
      area:         (row["Bereich"]   ?? "").toString(),
      role:         (row["Rolle"]     ?? "").toString(),
      squadron:     (row["Staffel"]   ?? "").toString(),
      status:       (row["Status"]    ?? "").toString(),
      ampel:        (row["Ampel"]     ?? "").toString(),
      appRole:      (row["AppRolle"]  ?? "viewer").toString().toLowerCase(),
      homeLocation: (row["Heimatort"] ?? "").toString(),
    });
  });
  cachedPlayers = list;
  return list;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function nameToFakeEmail(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@tcs.internal`;
}

function ampelColor(ampel?: string): string {
  if (ampel === "gut")    return "#16a34a";
  if (ampel === "mittel") return "#ca8a04";
  return "#dc2626";
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

// Sichert BoardState gegen fehlende Felder
function safeBoard(data: any, groups: Group[]): BoardState {
  const cols: Record<string, string[]> = {};
  for (const g of groups) {
    cols[g.id] = Array.isArray(data?.columns?.[g.id]) ? data.columns[g.id] : [];
  }
  return { groups, columns: cols };
}

// ─────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────

function LoginView({ onLogin }: { onLogin: (p: Player) => void }) {
  const [playerName, setPlayerName] = useState("");
  const [password,   setPassword]   = useState("");
  const [msg,        setMsg]        = useState("");
  const [loading,    setLoading]    = useState(false);

  async function handleLogin() {
    setMsg(""); setLoading(true);
    try {
      if (password !== TEAM_PASSWORD) { setMsg("Falsches Team-Passwort."); setLoading(false); return; }
      const players = await loadPlayers();
      const found   = players.find(p => p.name.toLowerCase() === playerName.trim().toLowerCase());
      if (!found) { setMsg(`"${playerName}" nicht gefunden.`); setLoading(false); return; }
      const email = nameToFakeEmail(found.name);
      const pw    = TEAM_PASSWORD + "_tcs_internal";
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
// SPIELER-KARTE
// ─────────────────────────────────────────────────────────────

function Card({
  player, aliveState, currentPlayerId, onToggleAlive,
}: {
  player: Player;
  aliveState: PlayerAliveState;
  currentPlayerId: string;
  onToggleAlive: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: player.id });

  const isDead = aliveState[player.id] === "dead";
  const isSelf = player.id === currentPlayerId;

  return (
    <div ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={`rounded-xl border p-2 shadow-sm cursor-grab active:cursor-grabbing transition-all
        ${isDead ? "bg-gray-900 border-red-900 opacity-60" : "bg-gray-800 border-gray-700"}`}
      {...attributes} {...listeners}
    >
      <div style={{ borderLeft: `3px solid ${ampelColor(player.ampel)}`, paddingLeft: 6 }}>
        <div className="flex items-center justify-between">
          <div className={`font-semibold text-sm ${isDead ? "line-through text-gray-500" : "text-white"}`}>
            {player.name}
          </div>
          {isSelf && (
            <button
              className={`text-xs px-1.5 py-0.5 rounded ml-2 border transition-colors
                ${isDead ? "bg-red-950 border-red-700 text-red-400 hover:bg-red-900"
                         : "bg-green-950 border-green-700 text-green-400 hover:bg-green-900"}`}
              onClick={e => { e.stopPropagation(); onToggleAlive(player.id); }}
            >
              {isDead ? "☠ Tot" : "✓ Live"}
            </button>
          )}
          {!isSelf && isDead && <span className="text-xs text-red-500 ml-2">☠</span>}
        </div>
        <div className="text-xs text-gray-400">
          {player.area}{player.role ? ` · ${player.role}` : ""}
          {player.homeLocation ? ` · 📍 ${player.homeLocation}` : ""}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GRUPPE (droppable)
// ─────────────────────────────────────────────────────────────

function DroppableColumn({
  group, ids, playersById, aliveState, currentPlayerId,
  onClear, canWrite, onToggleAlive, onRename, onDelete,
}: {
  group: Group;
  ids: string[];
  playersById: Record<string, Player>;
  aliveState: PlayerAliveState;
  currentPlayerId: string;
  onClear?: () => void;
  canWrite: boolean;
  onToggleAlive: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  const safeIds   = ids ?? [];
  const deadCount = safeIds.filter(pid => aliveState[pid] === "dead").length;
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(group.label);

  const isSystem = group.id === "unassigned";

  function commitRename() {
    if (draft.trim()) onRename(group.id, draft.trim());
    setEditing(false);
  }

  return (
    <div ref={setNodeRef}
      className={`rounded-xl border p-3 shadow-sm min-h-[200px] transition-colors flex flex-col
        ${group.isSpawn ? "border-yellow-700 bg-gray-900" : isOver ? "bg-gray-700 border-blue-500" : "bg-gray-900 border-gray-700"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-1">
        {editing && canWrite ? (
          <input
            className="flex-1 bg-gray-700 border border-gray-500 text-white text-sm rounded px-2 py-0.5 focus:outline-none"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => e.key === "Enter" && commitRename()}
            autoFocus
          />
        ) : (
          <div
            className={`font-semibold text-sm flex items-center gap-1 flex-1 min-w-0
              ${group.isSpawn ? "text-yellow-400" : "text-white"}
              ${canWrite && !isSystem ? "cursor-pointer hover:text-blue-300" : ""}`}
            onClick={() => { if (canWrite && !isSystem) { setDraft(group.label); setEditing(true); } }}
            title={canWrite && !isSystem ? "Klicken zum Umbenennen" : ""}
          >
            {group.isSpawn && <span className="text-yellow-500">⚓</span>}
            <span className="truncate">{group.label}</span>
            <span className="text-gray-500 font-normal flex-shrink-0">({safeIds.length})</span>
            {deadCount > 0 && <span className="text-red-500 text-xs flex-shrink-0">☠{deadCount}</span>}
          </div>
        )}
        <div className="flex gap-1 flex-shrink-0">
          {onClear && canWrite && (
            <button className="text-xs text-gray-600 hover:text-red-400 px-1" onClick={onClear} title="Leeren">↩</button>
          )}
          {canWrite && !isSystem && (
            <button className="text-xs text-gray-600 hover:text-red-500 px-1" onClick={() => onDelete(group.id)} title="Gruppe löschen">✕</button>
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
              onToggleAlive={onToggleAlive} />
          ) : null)}
        </div>
      </SortableContext>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ZOOMBARE KARTE
// ─────────────────────────────────────────────────────────────

function ZoomableMap({
  imageSrc, tokens, onMoveToken, canWrite, isAdmin,
  submaps, onOpenSubmap, onMoveSubmap, activeMapId,
}: {
  imageSrc: string;
  tokens: Token[];
  onMoveToken: (groupId: string, x: number, y: number) => void;
  canWrite: boolean;
  isAdmin: boolean;
  submaps: SubMap[];
  onOpenSubmap: (id: string) => void;
  onMoveSubmap: (id: string, x: number, y: number) => void;
  activeMapId: string;
}) {
  const [scale,      setScale]      = useState(1);
  const [offset,     setOffset]     = useState({ x: 0, y: 0 });
  const [tokenDrag,  setTokenDrag]  = useState<string | null>(null);
  const [submapDrag, setSubmapDrag] = useState<string | null>(null);
  const [panning,    setPanning]    = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale(s => Math.max(0.5, Math.min(5, s * (e.deltaY > 0 ? 0.9 : 1.1))));
  }

  function getMapCoords(e: React.PointerEvent): { x: number; y: number } | null {
    const img = document.getElementById("map-img");
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)),
    };
  }

  function onBgPointerDown(e: React.PointerEvent) {
    if (tokenDrag || submapDrag) return;
    setPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onBgPointerMove(e: React.PointerEvent) {
    if (panning && !tokenDrag && !submapDrag) {
      setOffset({
        x: panStart.current.ox + (e.clientX - panStart.current.x),
        y: panStart.current.oy + (e.clientY - panStart.current.y),
      });
    }
    if (tokenDrag) {
      const c = getMapCoords(e);
      if (c) onMoveToken(tokenDrag, c.x, c.y);
    }
    if (submapDrag) {
      const c = getMapCoords(e);
      if (c) onMoveSubmap(submapDrag, c.x, c.y);
    }
  }

  function onBgPointerUp() { setPanning(false); setTokenDrag(null); setSubmapDrag(null); }

  const visibleTokens = tokens.filter(t =>
    activeMapId === "main" ? !t.mapId : t.mapId === activeMapId
  );

  return (
    <div className="relative rounded-xl border border-gray-700 overflow-hidden bg-gray-950"
      style={{ height: 520 }}>
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
        {[
          { lbl: "+", fn: () => setScale(s => Math.min(5, s * 1.3)) },
          { lbl: "−", fn: () => setScale(s => Math.max(0.5, s / 1.3)) },
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
        onWheel={onWheel}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
      >
        <div style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: (panning || tokenDrag || submapDrag) ? "none" : "transform 0.1s",
          width: "100%", height: "100%", position: "relative",
        }}>
          <img id="map-img" src={imageSrc} alt="Map"
            className="w-full h-full object-contain block select-none" draggable={false} />

          {/* Submap-Marker – Admin kann verschieben */}
          {activeMapId === "main" && submaps.map(sm => (
            <div key={sm.id}
              className={`absolute z-10 flex items-center gap-1
                ${isAdmin ? "cursor-move" : "cursor-pointer"}`}
              style={{ left: `${sm.x * 100}%`, top: `${sm.y * 100}%`, transform: "translate(-50%,-50%)" }}
              onPointerDown={e => {
                e.stopPropagation();
                if (isAdmin) { setSubmapDrag(sm.id); }
              }}
              onClick={e => {
                e.stopPropagation();
                if (!submapDrag) onOpenSubmap(sm.id);
              }}
            >
              <div className={`bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-bold px-2 py-0.5 rounded-full border-2 border-yellow-300 shadow-lg select-none whitespace-nowrap`}>
                📍 {sm.label}
              </div>
              {isAdmin && (
                <span className="text-yellow-400 text-xs opacity-60">✥</span>
              )}
            </div>
          ))}

          {/* Gruppen-Tokens */}
          {visibleTokens.map(t => (
            <div key={t.groupId}
              className={`absolute z-10 rounded-full border-2 border-white bg-blue-600 text-white
                px-2 py-0.5 text-xs font-bold shadow-lg select-none
                ${canWrite ? "cursor-grab active:cursor-grabbing" : "cursor-default"}
                ${tokenDrag === t.groupId ? "ring-2 ring-yellow-400 scale-110" : ""}`}
              style={{ left: `${t.x*100}%`, top: `${t.y*100}%`, transform: "translate(-50%,-50%)" }}
              onPointerDown={e => { if (!canWrite) return; e.stopPropagation(); setTokenDrag(t.groupId); }}
            >
              {t.groupId}
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

function AutoMap({ submap }: { submap: SubMap }) {
  return (
    <div className="w-full bg-gray-800 rounded-xl border border-gray-600 flex items-center justify-center flex-col gap-3 p-8"
      style={{ height: 520 }}>
      <div className="text-gray-300 text-base font-medium">{submap.label}</div>
      <div className="text-gray-500 text-sm text-center">
        Kein Kartenbild vorhanden.<br />
        Lege eine Datei an unter:<br />
        <code className="text-blue-400 text-xs">public/maps/{submap.id}.png</code>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TOKEN-PLACER
// ─────────────────────────────────────────────────────────────

function MapPlacer({
  groups, onPlace, activeMapId,
}: {
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
      const y = (ev.clientY - rect.top)  / rect.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        onPlace(armed, x, y, activeMapId);
        setArmed(null);
      }
    }
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [armed, onPlace, activeMapId]);

  const currentMapLabel = activeMapId === "main" ? "Hauptkarte" : activeMapId;

  return (
    <div>
      <div className="text-xs text-gray-500 mb-2">
        Aktive Karte: <span className="text-blue-400">{currentMapLabel}</span>
      </div>
      {tactical.map(g => (
        <button key={g.id}
          className={`w-full rounded-lg border px-3 py-2 mb-1 text-sm font-medium transition-colors
            ${armed === g.id ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"}`}
          onClick={e => { e.stopPropagation(); setArmed(g.id); }}>
          {armed === g.id ? `▶ Klick auf Karte…` : `Setze ${g.label}`}
        </button>
      ))}
      {armed && (
        <button className="w-full rounded-lg border border-red-800 px-3 py-2 text-sm bg-red-950 text-red-400"
          onClick={e => { e.stopPropagation(); setArmed(null); }}>
          Abbrechen
        </button>
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

  const [user,          setUser]          = useState<User | null>(null);
  const [authReady,     setAuthReady]     = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [role,          setRole]          = useState<Role>("viewer");
  const [players,       setPlayers]       = useState<Player[]>([]);
  const [board,         setBoard]         = useState<BoardState>({
    groups: DEFAULT_GROUPS,
    columns: Object.fromEntries(DEFAULT_GROUPS.map(g => [g.id, []])),
  });
  const [tokens,      setTokens]      = useState<Token[]>([]);
  const [aliveState,  setAliveState]  = useState<PlayerAliveState>({});
  const [submaps,     setSubmaps]     = useState<SubMap[]>(DEFAULT_SUBMAPS);
  const [tab,         setTab]         = useState<"board" | "map">("board");
  const [activeMapId, setActiveMapId] = useState<string>("main");

  const playersById = useMemo(
    () => Object.fromEntries(players.map(p => [p.id, p])),
    [players]
  );

  const canWrite = role === "admin" || role === "commander";
  const isAdmin  = role === "admin";

  // ── Auth ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setAuthReady(true); });
    return () => unsub();
  }, []);

  // ── CSV ───────────────────────────────────────────────────
  useEffect(() => {
    loadPlayers().then(list => {
      setPlayers(list);
      setBoard(prev => {
        const all   = new Set(Object.values(prev.columns).flat());
        const toAdd = list.map(p => p.id).filter(id => !all.has(id));
        if (!toAdd.length) return prev;
        return {
          ...prev,
          columns: {
            ...prev.columns,
            unassigned: [...(prev.columns.unassigned ?? []), ...toAdd],
          },
        };
      });
    });
  }, []);

  // ── Rolle ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !currentPlayer) return;
    const sheetRole = (currentPlayer.appRole ?? "viewer") as Role;
    setRole(sheetRole);
    const memberRef = doc(db, "rooms", roomId, "members", user.uid);
    setDoc(memberRef, { role: sheetRole, name: currentPlayer.name }, { merge: true }).catch(console.error);
  }, [user, currentPlayer, roomId]);

  // ── Firestore Sync ────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const ref   = doc(db, "rooms", roomId, "state", "board");
    const unsub = onSnapshot(ref, snap => {
      const data = snap.data() as any;
      if (!data) return;

      // Gruppen aus Firestore laden (oder Default)
      const loadedGroups: Group[] = Array.isArray(data.groups) && data.groups.length > 0
        ? data.groups
        : DEFAULT_GROUPS;

      setBoard(safeBoard(data, loadedGroups));
      if (data.tokens)     setTokens(data.tokens     ?? []);
      if (data.aliveState) setAliveState(data.aliveState ?? {});
      if (data.submaps)    setSubmaps(data.submaps    ?? DEFAULT_SUBMAPS);
    });
    return () => unsub();
  }, [user, roomId]);

  // ── Firestore schreiben ───────────────────────────────────
  async function pushAll(
    nb: BoardState,
    nt: Token[],
    na: PlayerAliveState,
    ns: SubMap[],
  ) {
    try {
      await setDoc(doc(db, "rooms", roomId, "state", "board"), {
        groups:     nb.groups,
        columns:    nb.columns,
        tokens:     nt,
        aliveState: na,
        submaps:    ns,
        updatedAt:  serverTimestamp(),
      }, { merge: true });
    } catch (err) { console.error("Firestore:", err); }
  }

  // ── Tot/Lebendig ──────────────────────────────────────────
  function toggleAlive(playerId: string) {
    if (!currentPlayer || playerId !== currentPlayer.id) return;
    setAliveState(prev => {
      const wasDead  = prev[playerId] === "dead";
      const next     = { ...prev, [playerId]: wasDead ? "alive" : "dead" } as PlayerAliveState;

      // Wenn tot → automatisch in erste Spawn-Gruppe verschieben
      let nextBoard = board;
      if (!wasDead) {
        const spawnGroup = board.groups.find(g => g.isSpawn);
        if (spawnGroup) {
          // Spieler aus aktueller Gruppe entfernen
          const newCols = { ...board.columns };
          for (const gId of Object.keys(newCols)) {
            newCols[gId] = newCols[gId].filter(id => id !== playerId);
          }
          // In Spawn verschieben
          newCols[spawnGroup.id] = [playerId, ...(newCols[spawnGroup.id] ?? [])];
          nextBoard = { ...board, columns: newCols };
          setBoard(nextBoard);
        }
      }

      pushAll(nextBoard, tokens, next, submaps);
      return next;
    });
  }

  // ── Gruppen verwalten ─────────────────────────────────────

  function addGroup(isSpawn = false) {
    if (!canWrite) return;
    const newGroup: Group = {
      id:      uid(),
      label:   isSpawn ? "Spawn" : "Neue Gruppe",
      isSpawn,
    };
    setBoard(prev => {
      const next: BoardState = {
        groups:  [...prev.groups, newGroup],
        columns: { ...prev.columns, [newGroup.id]: [] },
      };
      pushAll(next, tokens, aliveState, submaps);
      return next;
    });
  }

  function renameGroup(id: string, label: string) {
    if (!canWrite) return;
    setBoard(prev => {
      const next: BoardState = {
        ...prev,
        groups: prev.groups.map(g => g.id === id ? { ...g, label } : g),
      };
      pushAll(next, tokens, aliveState, submaps);
      return next;
    });
  }

  function deleteGroup(id: string) {
    if (!canWrite || id === "unassigned") return;
    setBoard(prev => {
      const players = prev.columns[id] ?? [];
      const newCols = { ...prev.columns };
      delete newCols[id];
      newCols["unassigned"] = [...(newCols["unassigned"] ?? []), ...players];
      const next: BoardState = {
        groups:  prev.groups.filter(g => g.id !== id),
        columns: newCols,
      };
      pushAll(next, tokens.filter(t => t.groupId !== id), aliveState, submaps);
      setTokens(prev => prev.filter(t => t.groupId !== id));
      return next;
    });
  }

  function clearGroup(id: string) {
    if (!canWrite) return;
    setBoard(prev => {
      const players = prev.columns[id] ?? [];
      const next: BoardState = {
        ...prev,
        columns: {
          ...prev.columns,
          unassigned: [...(prev.columns["unassigned"] ?? []), ...players],
          [id]: [],
        },
      };
      pushAll(next, tokens, aliveState, submaps);
      return next;
    });
  }

  // ── Unterkarten verwalten ─────────────────────────────────

  function addSubmap() {
    if (!isAdmin) return;
    const newSm: SubMap = { id: uid(), label: "Neuer Ort", image: "", x: 0.5, y: 0.5 };
    const next = [...submaps, newSm];
    setSubmaps(next);
    pushAll(board, tokens, aliveState, next);
  }

  function renameSubmap(id: string, label: string) {
    if (!isAdmin) return;
    const next = submaps.map(s => s.id === id ? { ...s, label } : s);
    setSubmaps(next);
    pushAll(board, tokens, aliveState, next);
  }

  function deleteSubmap(id: string) {
    if (!isAdmin) return;
    const next = submaps.filter(s => s.id !== id);
    setSubmaps(next);
    if (activeMapId === id) setActiveMapId("main");
    pushAll(board, tokens, aliveState, next);
  }

  function moveSubmap(id: string, x: number, y: number) {
    if (!isAdmin) return;
    setSubmaps(prev => {
      const next = prev.map(s => s.id === id ? { ...s, x, y } : s);
      pushAll(board, tokens, aliveState, next);
      return next;
    });
  }

  // ── Drag & Drop ───────────────────────────────────────────
  function findContainer(playerId: string): string | null {
    for (const [gId, ids] of Object.entries(board.columns)) {
      if ((ids ?? []).includes(playerId)) return gId;
    }
    return null;
  }

  function onDragEnd(e: DragEndEvent) {
    if (!canWrite) return;
    const activeId = e.active.id.toString();
    const overId   = e.over?.id?.toString();
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
          const next: BoardState = {
            ...prev,
            columns: { ...prev.columns, [from]: arrayMove(prev.columns[from] ?? [], oi, ni) },
          };
          pushAll(next, tokens, aliveState, submaps);
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
          [to]:   [activeId, ...(prev.columns[to] ?? [])],
        },
      };
      pushAll(next, tokens, aliveState, submaps);
      return next;
    });
  }

  // ── Token ─────────────────────────────────────────────────
  const upsertToken = useCallback((gId: string, x: number, y: number, mapId: string) => {
    setTokens(prev => {
      const resolvedMapId = mapId === "main" ? undefined : mapId;
      const i    = prev.findIndex(t => t.groupId === gId && (t.mapId ?? "main") === mapId);
      const next = i === -1
        ? [...prev, { groupId: gId, x, y, mapId: resolvedMapId }]
        : prev.map((t, idx) => idx === i ? { groupId: gId, x, y, mapId: resolvedMapId } : t);
      pushAll(board, next, aliveState, submaps);
      return next;
    });
  }, [board, aliveState, submaps]);

  // ── Karte ─────────────────────────────────────────────────
  const currentMapImage = activeMapId === "main"
    ? "/pyro-map.png"
    : submaps.find(s => s.id === activeMapId)?.image ?? "";

  const currentSubmap = submaps.find(s => s.id === activeMapId);

  const selfAlive = currentPlayer ? (aliveState[currentPlayer.id] ?? "alive") : "alive";

  // ── Render ────────────────────────────────────────────────
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

  const tacticalGroups = board.groups.filter(g => g.id !== "unassigned" && !g.isSpawn);
  const spawnGroups    = board.groups.filter(g => g.isSpawn);
  const unassigned     = board.groups.find(g => g.id === "unassigned")!;

  return (
    <div className="min-h-screen bg-gray-950">

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-gray-800 bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="font-bold text-white">TCS</span>
            <span className="text-xs text-gray-500 font-mono">Room: {roomId}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className={`text-xs px-2 py-1 rounded-lg border font-medium transition-colors
                ${selfAlive === "dead"
                  ? "bg-red-950 border-red-700 text-red-400 hover:bg-red-900"
                  : "bg-green-950 border-green-700 text-green-400 hover:bg-green-900"}`}
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

      <main className="mx-auto max-w-7xl px-4 py-6">

        {/* ── BOARD-TAB ── */}
        {tab === "board" && (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="space-y-4">

              {/* Taktische Gruppen + Unzugeteilt */}
              <div className="grid gap-4"
                style={{ gridTemplateColumns: `200px repeat(${tacticalGroups.length}, 1fr)` }}>
                {/* Unzugeteilt */}
                <DroppableColumn
                  group={unassigned}
                  ids={board.columns["unassigned"] ?? []}
                  playersById={playersById}
                  aliveState={aliveState}
                  currentPlayerId={currentPlayer.id}
                  canWrite={canWrite}
                  onToggleAlive={toggleAlive}
                  onRename={renameGroup}
                  onDelete={deleteGroup}
                />
                {/* Taktische Gruppen */}
                {tacticalGroups.map(g => (
                  <DroppableColumn key={g.id} group={g}
                    ids={board.columns[g.id] ?? []}
                    playersById={playersById}
                    aliveState={aliveState}
                    currentPlayerId={currentPlayer.id}
                    canWrite={canWrite}
                    onToggleAlive={toggleAlive}
                    onRename={renameGroup}
                    onDelete={deleteGroup}
                    onClear={() => clearGroup(g.id)}
                  />
                ))}
              </div>

              {/* Aktionen */}
              {canWrite && (
                <div className="flex gap-2 flex-wrap">
                  <button
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 flex items-center gap-1"
                    onClick={() => addGroup(false)}>
                    + Gruppe hinzufügen
                  </button>
                  <button
                    className="text-xs px-3 py-1.5 rounded-lg border border-yellow-800 text-yellow-400 hover:bg-yellow-950 flex items-center gap-1"
                    onClick={() => addGroup(true)}>
                    ⚓ Spawn-Gruppe hinzufügen
                  </button>
                </div>
              )}

              {/* Spawn-Gruppen */}
              {spawnGroups.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Spawn-Bereiche</div>
                  <div className="grid gap-4"
                    style={{ gridTemplateColumns: `repeat(${Math.min(spawnGroups.length, 4)}, 1fr)` }}>
                    {spawnGroups.map(g => (
                      <DroppableColumn key={g.id} group={g}
                        ids={board.columns[g.id] ?? []}
                        playersById={playersById}
                        aliveState={aliveState}
                        currentPlayerId={currentPlayer.id}
                        canWrite={canWrite}
                        onToggleAlive={toggleAlive}
                        onRename={renameGroup}
                        onDelete={deleteGroup}
                        onClear={() => clearGroup(g.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DndContext>
        )}

        {/* ── KARTEN-TAB ── */}
        {tab === "map" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

            {/* Sidebar */}
            <div className="space-y-4">

              {/* Karten-Navigation */}
              <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
                <div className="font-semibold text-sm text-white mb-2">Karten</div>

                {/* Hauptkarte */}
                <button
                  className={`w-full rounded-lg border px-3 py-2 mb-1 text-sm text-left transition-colors
                    ${activeMapId === "main" ? "bg-blue-900 border-blue-600 text-blue-200" : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"}`}
                  onClick={() => setActiveMapId("main")}>
                  🗺 Pyro System
                </button>

                {/* Unterkarten – eingerückt */}
                {submaps.map(sm => (
                  <div key={sm.id} className="ml-4 flex items-center gap-1 mb-1">
                    {/* Einrückungs-Linie */}
                    <div className="w-3 h-px bg-gray-600 flex-shrink-0" />
                    <button
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs text-left transition-colors
                        ${activeMapId === sm.id ? "bg-blue-900 border-blue-600 text-blue-200" : "bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-gray-200"}`}
                      onClick={() => setActiveMapId(sm.id)}>
                      {/* Inline-Rename für Admin */}
                      {isAdmin ? (
                        <SubmapLabel
                          label={sm.label}
                          onRename={label => renameSubmap(sm.id, label)}
                        />
                      ) : (
                        <span>📍 {sm.label}</span>
                      )}
                    </button>
                    {isAdmin && (
                      <button
                        className="text-gray-600 hover:text-red-500 text-xs px-1 flex-shrink-0"
                        onClick={() => deleteSubmap(sm.id)}
                        title="Unterort löschen">
                        ✕
                      </button>
                    )}
                  </div>
                ))}

                {/* Unterort hinzufügen */}
                {isAdmin && (
                  <button
                    className="ml-4 mt-1 text-xs px-2 py-1 rounded-lg border border-gray-700 text-gray-500 hover:text-gray-300 hover:bg-gray-800 w-[calc(100%-1rem)]"
                    onClick={addSubmap}>
                    + Unterort hinzufügen
                  </button>
                )}
              </div>

              {/* Token-Placer */}
              {canWrite && (
                <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
                  <div className="font-semibold text-sm text-white mb-2">Token setzen</div>
                  <MapPlacer
                    groups={board.groups}
                    onPlace={(gId, x, y, mapId) => upsertToken(gId, x, y, mapId)}
                    activeMapId={activeMapId}
                  />
                </div>
              )}
            </div>

            {/* Karte */}
            <div className="lg:col-span-3">
              <div className="flex items-center gap-2 mb-2 text-sm text-gray-400">
                <button className="hover:text-white" onClick={() => setActiveMapId("main")}>Pyro System</button>
                {activeMapId !== "main" && (
                  <><span>›</span><span className="text-white">{currentSubmap?.label}</span></>
                )}
                {isAdmin && activeMapId === "main" && (
                  <span className="text-yellow-600 text-xs ml-2">✥ Admin: Unterorte verschiebbar</span>
                )}
              </div>

              {activeMapId !== "main" && currentSubmap && !currentSubmap.image ? (
                <AutoMap submap={currentSubmap} />
              ) : (
                <ZoomableMap
                  imageSrc={currentMapImage}
                  tokens={tokens}
                  onMoveToken={(gId, x, y) => upsertToken(gId, x, y, activeMapId)}
                  canWrite={canWrite}
                  isAdmin={isAdmin}
                  submaps={activeMapId === "main" ? submaps : []}
                  onOpenSubmap={id => setActiveMapId(id)}
                  onMoveSubmap={moveSubmap}
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
// SUBMAP LABEL (inline editierbar)
// ─────────────────────────────────────────────────────────────

function SubmapLabel({ label, onRename }: { label: string; onRename: (l: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(label);

  function commit() {
    if (draft.trim()) onRename(draft.trim());
    setEditing(false);
  }

  if (editing) return (
    <input
      className="w-full bg-gray-700 text-white text-xs rounded px-1 focus:outline-none"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commit(); }}
      onClick={e => e.stopPropagation()}
      autoFocus
    />
  );

  return (
    <span
      className="flex items-center gap-1 cursor-text"
      onClick={e => { e.stopPropagation(); setDraft(label); setEditing(true); }}
      title="Klicken zum Umbenennen"
    >
      📍 {label} <span className="text-gray-600 text-xs">✎</span>
    </span>
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
