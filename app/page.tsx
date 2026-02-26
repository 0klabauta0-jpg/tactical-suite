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
// KONFIGURATION – Gruppenbezeichnungen hier anpassen
// ─────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  g1: "Marines",
  g2: "Air",
  g3: "Subradar",
  g4: "SAR",
  g5: "Command",
};

// Unterkarten-Definitionen
// image: Pfad unter /public/maps/ (leer = Auto-Karte wird angezeigt)
// x/y: Position des Markers auf der Hauptkarte (0-1)
const SUBMAPS: SubMap[] = [
  { id: "pyro1_base",   label: "Fallow Field",  image: "/maps/Fallow Field 500m.png",  x: 0.25, y: 0.35 },
  { id: "ruin_station", label: "Ruin Station",  image: "",                      x: 0.55, y: 0.45 },
  { id: "checkmate",    label: "Checkmate",     image: "/maps/checkmate.png",  x: 0.70, y: 0.60 },
];

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

type GroupId = "unassigned" | "g1" | "g2" | "g3" | "g4" | "g5";

type BoardState = Record<GroupId, string[]>;

type Token = {
  groupId: Exclude<GroupId, "unassigned">;
  x: number;
  y: number;
  mapId?: string;
};

type PlayerAliveState = Record<string, "alive" | "dead">;

type SubMap = {
  id: string;
  label: string;
  image: string;
  x: number;
  y: number;
};

type Role = "admin" | "commander" | "viewer";

const SHEET_CSV_URL = process.env.NEXT_PUBLIC_SHEET_CSV_URL ?? "";
const TEAM_PASSWORD = process.env.NEXT_PUBLIC_TEAM_PASSWORD ?? "";

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
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${clean}@tcs.internal`;
}

function ampelColor(ampel?: string): string {
  if (ampel === "gut")    return "#16a34a";
  if (ampel === "mittel") return "#ca8a04";
  return "#dc2626";
}

// ─────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────

function LoginView({ onLogin }: { onLogin: (player: Player) => void }) {
  const [playerName, setPlayerName] = useState("");
  const [password,   setPassword]   = useState("");
  const [msg,        setMsg]        = useState("");
  const [loading,    setLoading]    = useState(false);

  async function handleLogin() {
    setMsg(""); setLoading(true);
    try {
      if (password !== TEAM_PASSWORD) {
        setMsg("Falsches Team-Passwort."); setLoading(false); return;
      }
      const players = await loadPlayers();
      const found   = players.find(
        p => p.name.toLowerCase() === playerName.trim().toLowerCase()
      );
      if (!found) {
        setMsg(`Spieler "${playerName}" nicht gefunden.`); setLoading(false); return;
      }
      const fakeEmail  = nameToFakeEmail(found.name);
      const firebasePw = TEAM_PASSWORD + "_tcs_internal";
      try { await signInWithEmailAndPassword(auth, fakeEmail, firebasePw); }
      catch { await createUserWithEmailAndPassword(auth, fakeEmail, firebasePw); }
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
        <input
          className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-3 text-sm focus:outline-none focus:border-blue-500"
          placeholder="z.B. KRT_Bjoern" value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <label className="text-gray-300 text-xs mb-1 block">Team-Passwort</label>
        <input
          className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-5 text-sm focus:outline-none focus:border-blue-500"
          type="password" placeholder="Team-Passwort" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <button
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          onClick={handleLogin} disabled={loading || !playerName || !password}>
          {loading ? "Einloggen..." : "Einloggen"}
        </button>
        {msg ? <p className="mt-3 text-red-400 text-xs">{msg}</p> : null}
        <p className="mt-4 text-gray-600 text-xs text-center">
          Spielername exakt wie im Sheet.
        </p>
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

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isDead = aliveState[player.id] === "dead";
  const isSelf = player.id === currentPlayerId;

  return (
    <div
      ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`rounded-xl border p-2 shadow-sm cursor-grab active:cursor-grabbing transition-all
        ${isDead ? "bg-gray-900 border-red-900 opacity-60" : "bg-gray-800 border-gray-700"}`}
    >
      <div style={{ borderLeft: `3px solid ${ampelColor(player.ampel)}`, paddingLeft: 6 }}>
        <div className="flex items-center justify-between">
          <div className={`font-semibold text-sm ${isDead ? "line-through text-gray-500" : "text-white"}`}>
            {player.name}
          </div>
          {isSelf && (
            <button
              className={`text-xs px-1.5 py-0.5 rounded ml-2 border transition-colors
                ${isDead
                  ? "bg-red-950 border-red-700 text-red-400 hover:bg-red-900"
                  : "bg-green-950 border-green-700 text-green-400 hover:bg-green-900"
                }`}
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
  id, title, ids, playersById, aliveState, currentPlayerId,
  onClear, canWrite, onToggleAlive,
}: {
  id: GroupId; title: string; ids: string[];
  playersById: Record<string, Player>;
  aliveState: PlayerAliveState;
  currentPlayerId: string;
  onClear?: () => void; canWrite: boolean;
  onToggleAlive: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const deadCount = ids.filter(pid => aliveState[pid] === "dead").length;

  return (
    <div ref={setNodeRef}
      className={`rounded-xl border p-3 shadow-sm min-h-[300px] transition-colors
        ${isOver ? "bg-gray-700 border-blue-500" : "bg-gray-900 border-gray-700"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm text-white">
          {title}
          <span className="ml-1 text-gray-500 font-normal">({ids.length})</span>
          {deadCount > 0 && <span className="ml-1 text-red-500 text-xs"> ☠{deadCount}</span>}
        </div>
        {onClear && canWrite && (
          <button className="text-xs text-gray-500 hover:text-red-400" onClick={onClear}>
            leeren
          </button>
        )}
      </div>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="space-y-1 min-h-[150px]">
          {ids.length === 0 && (
            <div className="text-xs text-gray-600 border border-dashed border-gray-700 rounded-lg p-4 text-center">
              hierher ziehen
            </div>
          )}
          {ids.map(pid => playersById[pid] ? (
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
  imageSrc, tokens, onMoveToken, canWrite,
  submaps, onOpenSubmap, activeMapId,
}: {
  imageSrc: string;
  tokens: Token[];
  onMoveToken: (groupId: string, x: number, y: number) => void;
  canWrite: boolean;
  submaps: SubMap[];
  onOpenSubmap: (id: string) => void;
  activeMapId: string;
}) {
  const [scale,    setScale]    = useState(1);
  const [offset,   setOffset]   = useState({ x: 0, y: 0 });
  const [tokenDrag, setTokenDrag] = useState<string | null>(null);
  const [panning,  setPanning]  = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale(s => Math.max(0.5, Math.min(5, s * (e.deltaY > 0 ? 0.9 : 1.1))));
  }

  function onBgPointerDown(e: React.PointerEvent) {
    if (tokenDrag) return;
    setPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onBgPointerMove(e: React.PointerEvent) {
    if (panning && !tokenDrag) {
      setOffset({
        x: panStart.current.ox + (e.clientX - panStart.current.x),
        y: panStart.current.oy + (e.clientY - panStart.current.y),
      });
    }
    if (tokenDrag) {
      const img = document.getElementById("map-img");
      if (!img) return;
      const rect = img.getBoundingClientRect();
      onMoveToken(
        tokenDrag,
        Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)),
      );
    }
  }

  function onBgPointerUp() { setPanning(false); setTokenDrag(null); }

  const visibleTokens = tokens.filter(t =>
    activeMapId === "main" ? !t.mapId : t.mapId === activeMapId
  );

  return (
    <div className="relative rounded-xl border border-gray-700 overflow-hidden bg-gray-950"
      style={{ height: 520 }}>

      {/* Zoom-Buttons */}
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
          transition: panning || tokenDrag ? "none" : "transform 0.1s",
          width: "100%", height: "100%", position: "relative",
        }}>
          <img id="map-img" src={imageSrc} alt="Map"
            className="w-full h-full object-contain block select-none" draggable={false} />

          {/* Submap-Marker */}
          {activeMapId === "main" && submaps.map(sm => (
            <button key={sm.id}
              className="absolute z-10 bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-bold px-2 py-0.5 rounded-full border-2 border-yellow-300 shadow-lg"
              style={{ left: `${sm.x * 100}%`, top: `${sm.y * 100}%`, transform: "translate(-50%,-50%)" }}
              onClick={e => { e.stopPropagation(); onOpenSubmap(sm.id); }}>
              📍 {sm.label}
            </button>
          ))}

          {/* Gruppen-Tokens */}
          {visibleTokens.map(t => (
            <div key={t.groupId}
              className={`absolute z-10 rounded-full border-2 border-white bg-blue-600 text-white
                px-2 py-0.5 text-xs font-bold shadow-lg select-none
                ${canWrite ? "cursor-grab active:cursor-grabbing" : "cursor-default"}
                ${tokenDrag === t.groupId ? "ring-2 ring-yellow-400 scale-110" : ""}`}
              style={{ left: `${t.x*100}%`, top: `${t.y*100}%`, transform: "translate(-50%,-50%)" }}
              onPointerDown={e => {
                if (!canWrite) return;
                e.stopPropagation();
                setTokenDrag(t.groupId);
              }}>
              {GROUP_LABELS[t.groupId] ?? t.groupId}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AUTO-KARTE (Fallback wenn kein Bild)
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
  onPlace, activeMapId,
}: {
  onPlace: (g: Exclude<GroupId, "unassigned">, x: number, y: number, mapId: string) => void;
  activeMapId: string;
}) {
  const [armed, setArmed] = useState<Exclude<GroupId, "unassigned"> | null>(null);

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

  const currentMapLabel = activeMapId === "main"
    ? "Hauptkarte"
    : SUBMAPS.find(s => s.id === activeMapId)?.label ?? activeMapId;

  return (
    <div>
      <div className="text-xs text-gray-500 mb-2">
        Aktive Karte: <span className="text-blue-400">{currentMapLabel}</span>
      </div>
      {(Object.keys(GROUP_LABELS) as Exclude<GroupId, "unassigned">[]).map(g => (
        <button key={g}
          className={`w-full rounded-lg border px-3 py-2 mb-1 text-sm font-medium transition-colors
            ${armed === g
              ? "bg-blue-600 border-blue-500 text-white"
              : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"}`}
          onClick={e => { e.stopPropagation(); setArmed(g); }}>
          {armed === g ? `▶ Klick auf Karte…` : `Setze ${GROUP_LABELS[g]}`}
        </button>
      ))}
      {armed && (
        <button
          className="w-full rounded-lg border border-red-800 px-3 py-2 text-sm bg-red-950 text-red-400"
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
    unassigned: [], g1: [], g2: [], g3: [], g4: [], g5: [],
  });
  const [tokens,        setTokens]        = useState<Token[]>([]);
  const [aliveState,    setAliveState]    = useState<PlayerAliveState>({});
  const [tab,           setTab]           = useState<"board" | "map">("board");
  const [activeMapId,   setActiveMapId]   = useState<string>("main");

  const playersById = useMemo(
    () => Object.fromEntries(players.map(p => [p.id, p])),
    [players]
  );

  const canWrite = role === "admin" || role === "commander";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setAuthReady(true); });
    return () => unsub();
  }, []);

  useEffect(() => {
    loadPlayers().then(list => {
      setPlayers(list);
      setBoard(prev => {
        const all   = new Set(Object.values(prev).flat());
        const toAdd = list.map(p => p.id).filter(id => !all.has(id));
        if (!toAdd.length) return prev;
        return { ...prev, unassigned: [...prev.unassigned, ...toAdd] };
      });
    });
  }, []);

  useEffect(() => {
    if (!user || !currentPlayer) return;
    const sheetRole = (currentPlayer.appRole ?? "viewer") as Role;
    setRole(sheetRole);
    const memberRef = doc(db, "rooms", roomId, "members", user.uid);
    setDoc(memberRef, { role: sheetRole, name: currentPlayer.name }, { merge: true }).catch(console.error);
  }, [user, currentPlayer, roomId]);

  useEffect(() => {
    if (!user) return;
    const ref   = doc(db, "rooms", roomId, "state", "board");
    const unsub = onSnapshot(ref, snap => {
      const data = snap.data() as any;
      if (!data) return;
      if (data.board)      setBoard(data.board);
      if (data.tokens)     setTokens(data.tokens);
      if (data.aliveState) setAliveState(data.aliveState);
    });
    return () => unsub();
  }, [user, roomId]);

  async function pushState(nb: BoardState, nt: Token[], na: PlayerAliveState) {
    try {
      await setDoc(doc(db, "rooms", roomId, "state", "board"), {
        board: nb, tokens: nt, aliveState: na, updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) { console.error("Firestore:", err); }
  }

  function toggleAlive(playerId: string) {
    if (!currentPlayer || playerId !== currentPlayer.id) return;
    setAliveState(prev => {
      const next = { ...prev, [playerId]: prev[playerId] === "dead" ? "alive" : "dead" } as PlayerAliveState;
      pushState(board, tokens, next);
      return next;
    });
  }

  function findContainer(id: string): GroupId | null {
    for (const k of Object.keys(board) as GroupId[]) {
      if (board[k].includes(id)) return k;
    }
    return null;
  }

  function onDragEnd(e: DragEndEvent) {
    if (!canWrite) return;
    const activeId = e.active.id.toString();
    const overId   = e.over?.id?.toString();
    if (!overId) return;
    const from = findContainer(activeId);
    const to: GroupId | null =
      (Object.keys(board) as GroupId[]).includes(overId as GroupId)
        ? (overId as GroupId) : findContainer(overId);
    if (!from || !to) return;
    if (from === to) {
      const oi = board[from].indexOf(activeId);
      const ni = board[from].indexOf(overId);
      if (oi !== -1 && ni !== -1 && oi !== ni) {
        setBoard(prev => {
          const next = { ...prev, [from]: arrayMove(prev[from], oi, ni) };
          pushState(next, tokens, aliveState);
          return next;
        });
      }
      return;
    }
    setBoard(prev => {
      const next = {
        ...prev,
        [from]: prev[from].filter(x => x !== activeId),
        [to]:   [activeId, ...prev[to]],
      };
      pushState(next, tokens, aliveState);
      return next;
    });
  }

  function clearGroup(g: Exclude<GroupId, "unassigned">) {
    setBoard(prev => {
      const next: BoardState = {
        ...prev, unassigned: [...prev.unassigned, ...prev[g]], [g]: [],
      };
      const nt = tokens.filter(t => t.groupId !== g);
      pushState(next, nt, aliveState);
      setTokens(nt);
      return next;
    });
  }

  const upsertToken = useCallback((
    groupId: Exclude<GroupId, "unassigned">,
    x: number, y: number, mapId: string,
  ) => {
    setTokens(prev => {
      const resolvedMapId = mapId === "main" ? undefined : mapId;
      const i    = prev.findIndex(t => t.groupId === groupId && (t.mapId ?? "main") === mapId);
      const next = i === -1
        ? [...prev, { groupId, x, y, mapId: resolvedMapId }]
        : prev.map((t, idx) => idx === i ? { groupId, x, y, mapId: resolvedMapId } : t);
      pushState(board, next, aliveState);
      return next;
    });
  }, [board, aliveState]);

  const currentMapImage = activeMapId === "main"
    ? "/pyro-map.png"
    : SUBMAPS.find(s => s.id === activeMapId)?.image ?? "";

  const currentSubmap = SUBMAPS.find(s => s.id === activeMapId);

  const selfAlive = currentPlayer ? (aliveState[currentPlayer.id] ?? "alive") : "alive";

  if (!authReady) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400">Laden...</div>
    </div>
  );

  if (!user || !currentPlayer) return (
    <LoginView onLogin={p => setCurrentPlayer(p)} />
  );

  const roleBadge =
    role === "admin"     ? "bg-red-900 text-red-300 border border-red-700" :
    role === "commander" ? "bg-blue-900 text-blue-300 border border-blue-700" :
                           "bg-gray-800 text-gray-400 border border-gray-600";

  return (
    <div className="min-h-screen bg-gray-950">
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

        {tab === "board" && (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div className="md:col-span-1">
                <DroppableColumn
                  id="unassigned" title="Unzugeteilt"
                  ids={board.unassigned} playersById={playersById}
                  aliveState={aliveState} currentPlayerId={currentPlayer.id}
                  canWrite={canWrite} onToggleAlive={toggleAlive} />
              </div>
              <div className="md:col-span-5 grid grid-cols-2 lg:grid-cols-5 gap-4">
                {(Object.keys(GROUP_LABELS) as Exclude<GroupId, "unassigned">[]).map(g => (
                  <DroppableColumn key={g} id={g} title={GROUP_LABELS[g]}
                    ids={board[g]} playersById={playersById}
                    aliveState={aliveState} currentPlayerId={currentPlayer.id}
                    canWrite={canWrite} onToggleAlive={toggleAlive}
                    onClear={() => clearGroup(g)} />
                ))}
              </div>
            </div>
          </DndContext>
        )}

        {tab === "map" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="space-y-4">
              {/* Karten-Navigation */}
              <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
                <div className="font-semibold text-sm text-white mb-2">Karten</div>
                <button
                  className={`w-full rounded-lg border px-3 py-2 mb-1 text-sm text-left transition-colors
                    ${activeMapId === "main"
                      ? "bg-blue-900 border-blue-600 text-blue-200"
                      : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"}`}
                  onClick={() => setActiveMapId("main")}>
                  🗺 Pyro System
                </button>
                {SUBMAPS.map(sm => (
                  <button key={sm.id}
                    className={`w-full rounded-lg border px-3 py-2 mb-1 text-sm text-left transition-colors
                      ${activeMapId === sm.id
                        ? "bg-blue-900 border-blue-600 text-blue-200"
                        : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"}`}
                    onClick={() => setActiveMapId(sm.id)}>
                    📍 {sm.label}
                  </button>
                ))}
              </div>

              {canWrite && (
                <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
                  <div className="font-semibold text-sm text-white mb-2">Token setzen</div>
                  <MapPlacer
                    onPlace={(g, x, y, mapId) => upsertToken(g, x, y, mapId)}
                    activeMapId={activeMapId} />
                </div>
              )}
            </div>

            <div className="lg:col-span-3">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 mb-2 text-sm text-gray-400">
                <button className="hover:text-white" onClick={() => setActiveMapId("main")}>
                  Pyro System
                </button>
                {activeMapId !== "main" && (
                  <><span>›</span><span className="text-white">{currentSubmap?.label}</span></>
                )}
              </div>

              {activeMapId !== "main" && currentSubmap && !currentSubmap.image ? (
                <AutoMap submap={currentSubmap} />
              ) : (
                <ZoomableMap
                  imageSrc={currentMapImage}
                  tokens={tokens}
                  onMoveToken={(g, x, y) => upsertToken(g as any, x, y, activeMapId)}
                  canWrite={canWrite}
                  submaps={activeMapId === "main" ? SUBMAPS : []}
                  onOpenSubmap={id => setActiveMapId(id)}
                  activeMapId={activeMapId} />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

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
