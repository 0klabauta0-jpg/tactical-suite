"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import Papa from "papaparse";
import { DndContext, DragEndEvent, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSearchParams } from "next/navigation";
import { db, auth } from "@/lib/firebase";
import { doc, onSnapshot, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  User,
} from "firebase/auth";

// ─────────────────────────────────────────────────────────────
// TYPES
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

// color: optional hex ohne #, z.B. "e63946"
type Group = { id: string; label: string; isSpawn?: boolean; color?: string };
type BoardState = { groups: Group[]; columns: Record<string, string[]> };

// GroupRoles: leader/deputy pro Gruppe
type GroupRoles = Record<string, { leader?: string; deputy?: string }>;

type Token = { groupId: string; x: number; y: number; mapId?: string };
type MapEntry = { id: string; label: string; image: string; x?: number; y?: number };
type POI = { id: string; label: string; image: string; parentMapId: string; x?: number; y?: number };
type PlayerAliveState = Record<string, "alive" | "dead">;
type PlayerSpawnState = Record<string, string>;
type Role = "admin" | "commander" | "viewer";
type PanelLayout = {
  nav:    { x: number; y: number };
  placer: { x: number; y: number };
  notes:  { x: number; y: number; w: number; h: number };
};

const SHEET_CSV_URL = process.env.NEXT_PUBLIC_SHEET_CSV_URL ?? "";
const TEAM_PASSWORD = process.env.NEXT_PUBLIC_TEAM_PASSWORD ?? "";

const DEFAULT_GROUPS: Group[] = [
  { id: "unassigned", label: "Unzugeteilt" },
  { id: "g1", label: "Marines" },
  { id: "g2", label: "Air" },
  { id: "g3", label: "Subradar" },
  { id: "spawn1", label: "Spawn", isSpawn: true },
];

const DEFAULT_MAPS: MapEntry[] = [{ id: "main", label: "Pyro System", image: "/pyro-map.png" }];

const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  nav:    { x: 16, y: 16 },
  placer: { x: 16, y: 340 },
  notes:  { x: 300, y: 16, w: 320, h: 200 },
};

// ─── DRAWING TYPES ───────────────────────────────────────────
type DrawTool = "pointer" | "pen" | "line" | "eraser" | "text";

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
type DrawElement = DrawStroke | DrawText | DrawLine;
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

function nameToFakeEmail(n: string) {
  return `${n.toLowerCase().replace(/[^a-z0-9]/g, "")}@tcs.internal`;
}

function ampelColor(a?: string) {
  if (a === "gut") return "#16a34a";
  if (a === "mittel") return "#ca8a04";
  return "#dc2626";
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function safeBoard(data: any, groups: Group[]): BoardState {
  const cols: Record<string, string[]> = {};
  for (const g of groups) cols[g.id] = Array.isArray(data?.columns?.[g.id]) ? data.columns[g.id] : [];
  return { groups, columns: cols };
}

function normalizeToken(t: Token): Token {
  return { ...t, mapId: (t.mapId ?? "main") };
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
      const found = players.find((p) => p.name.toLowerCase() === playerName.trim().toLowerCase());
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
          placeholder="z.B. KRT_Bjoern" value={playerName} onChange={(e) => setPlayerName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
        <label className="text-gray-300 text-xs mb-1 block">Team-Passwort</label>
        <input className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-5 text-sm focus:outline-none focus:border-blue-500"
          type="password" placeholder="Team-Passwort" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
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

function InlineEdit({ value, onSave, className = "" }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
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

// ─────────────────────────────────────────────────────────────
// DRAGGABLE PANEL
// ─────────────────────────────────────────────────────────────

function DraggablePanel({ title, x, y, onMove, canDrag, children, minWidth = 220 }: {
  title: string; x: number; y: number; onMove: (x: number, y: number) => void;
  canDrag: boolean; children: React.ReactNode; minWidth?: number;
}) {
  const dragging = useRef(false);
  const start = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  function onPointerDown(e: React.PointerEvent) {
    if (!canDrag) return;
    dragging.current = true;
    start.current = { mx: e.clientX, my: e.clientY, px: x, py: y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    onMove(Math.max(0, start.current.px + e.clientX - start.current.mx), Math.max(0, start.current.py + e.clientY - start.current.my));
  }
  function onPointerUp() { dragging.current = false; }
  return (
    <div className="absolute z-20 rounded-xl border border-gray-700 bg-gray-900 bg-opacity-95 shadow-xl overflow-hidden"
      style={{ left: x, top: y, minWidth, maxWidth: 320 }}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800 select-none ${canDrag ? "cursor-move" : "cursor-default"}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {canDrag && <span className="text-gray-500 text-xs">⠿</span>}
        <span className="text-xs font-semibold text-gray-300">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PLAYER CARD
// ─────────────────────────────────────────────────────────────

function Card({ player, aliveState, currentPlayerId, canWrite, onToggleAlive, spawnGroups, spawnState, onSetSpawn,
  groupRoles, groupId, onSetRole, groupColor: gColor,
}: {
  player: Player; aliveState: PlayerAliveState; currentPlayerId: string; canWrite: boolean;
  onToggleAlive: (id: string) => void; spawnGroups: Group[]; spawnState: PlayerSpawnState;
  onSetSpawn: (pid: string, sid: string) => void;
  groupRoles: GroupRoles; groupId: string; onSetRole: (gId: string, pid: string, role: "leader" | "deputy" | null) => void;
  groupColor: string;
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
      <div {...attributes} {...listeners} className="px-2 pt-2 pb-1 cursor-grab active:cursor-grabbing"
        style={{ borderLeft: `3px solid ${ampelColor(player.ampel)}`, paddingLeft: 8 }}>
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {/* Sterne-Anzeige */}
            {isLeader  && <span className="text-yellow-400 text-xs flex-shrink-0" title="Gruppenleader">★★</span>}
            {isDeputy  && <span className="text-yellow-400 text-xs flex-shrink-0" title="Stellvertreter">★</span>}
            <div className={`font-semibold text-sm truncate ${isDead ? "line-through text-gray-500" : "text-white"}`}>{player.name}</div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Rollen-Buttons (Admin/Commander) */}
            {canWrite && groupId !== "unassigned" && (
              <>
                <button className={`text-xs px-1 rounded ${isLeader ? "text-yellow-400" : "text-gray-600 hover:text-yellow-500"}`}
                  title={isLeader ? "Leader entfernen" : "Zum Leader machen"}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onSetRole(groupId, player.id, isLeader ? null : "leader"); }}>
                  ★★
                </button>
                <button className={`text-xs px-1 rounded ${isDeputy ? "text-yellow-400" : "text-gray-600 hover:text-yellow-500"}`}
                  title={isDeputy ? "Deputy entfernen" : "Zum Stellvertreter machen"}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onSetRole(groupId, player.id, isDeputy ? null : "deputy"); }}>
                  ★
                </button>
              </>
            )}
            {canToggle && (
              <button
                className={`text-sm px-2 py-1 rounded border font-bold transition-colors ${
                  isDead ? "bg-red-950 border-red-700 text-red-300 hover:bg-red-900" : "bg-green-950 border-green-700 text-green-300 hover:bg-green-900"
                }`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onToggleAlive(player.id); }}>
                {isDead ? "☠" : "✓"}
              </button>
            )}
            {!canToggle && isDead && <span className="text-red-500 flex-shrink-0">☠</span>}
          </div>
        </div>
        <div className="text-xs text-gray-400 truncate mt-0.5">
          {player.area}{player.role ? ` · ${player.role}` : ""}{player.homeLocation ? ` · 📍${player.homeLocation}` : ""}
        </div>
      </div>
      {(isSelf || canWrite) && spawnGroups.length > 0 && (
        <div className="px-2 pb-2" onPointerDown={(e) => e.stopPropagation()}>
          <select className="w-full bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded px-1 py-0.5 focus:outline-none"
            value={spawnState[player.id] ?? ""}
            onChange={(e) => onSetSpawn(player.id, e.target.value)}>
            <option value="">⚓ Spawn…</option>
            {spawnGroups.map((sg) => <option key={sg.id} value={sg.id}>{sg.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

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
          <div key={g.id} className="rounded-xl border border-yellow-800 bg-gray-900 px-3 py-2 flex items-center gap-2 min-w-[160px]">
            <span className="text-yellow-400 text-xs font-semibold flex items-center gap-1">
              ⚓ {canWrite ? <InlineEdit value={g.label} onSave={(v) => onRename(g.id, v)} /> : g.label}
              <span className="text-gray-500 font-normal">({ids.length})</span>
            </span>
            <div className="flex gap-1 flex-wrap">
              {ids.slice(0, 5).map((pid) => {
                const p = playersById[pid];
                if (!p) return null;
                return (
                  <span key={pid} className={`text-xs px-1.5 py-0.5 rounded border ${aliveState[pid] === "dead" ? "border-red-800 text-red-400 line-through" : "border-gray-600 text-gray-300"}`}>
                    {p.name}
                  </span>
                );
              })}
              {ids.length > 5 && <span className="text-xs text-gray-500">+{ids.length - 5}</span>}
            </div>
            {canWrite && (
              <div className="flex gap-1 ml-auto flex-shrink-0">
                <button className="text-xs text-gray-600 hover:text-yellow-400" onClick={() => onClear(g.id)} title="Leeren">↩</button>
                <button className="text-xs text-gray-600 hover:text-red-500" onClick={() => onDelete(g.id)} title="Löschen">✕</button>
              </div>
            )}
          </div>
        );
      })}
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

function DroppableColumn({ group, ids, playersById, aliveState, currentPlayerId, canWrite, onToggleAlive,
  onRename, onDelete, onClear, spawnGroups, spawnState, onSetSpawn, groupRoles, onSetRole, onSetColor,
}: {
  group: Group; ids: string[]; playersById: Record<string, Player>; aliveState: PlayerAliveState;
  currentPlayerId: string; canWrite: boolean;
  onToggleAlive: (id: string) => void; onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void; onClear?: () => void;
  spawnGroups: Group[]; spawnState: PlayerSpawnState; onSetSpawn: (pid: string, sid: string) => void;
  groupRoles: GroupRoles; onSetRole: (gId: string, pid: string, role: "leader" | "deputy" | null) => void;
  onSetColor: (id: string, hex: string) => void;
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
  const deadCount = safeIds.filter((pid) => aliveState[pid] === "dead").length;
  const isSystem = group.id === "unassigned";
  const gColor = groupColor(group);

  return (
    <div
      style={{
        width: 200, flexShrink: 0,
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
            {/* Farbwähler */}
            {canWrite && !isSystem && (
              <ColorPicker current={group.color} onChange={(hex) => onSetColor(group.id, hex)} />
            )}
            {canWrite && !isSystem
              ? <InlineEdit value={group.label} onSave={(v) => onRename(group.id, v)} className="flex-1" />
              : <span className="truncate">{group.label}</span>}
            <span className="text-gray-500 font-normal text-xs flex-shrink-0">({safeIds.length})</span>
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
                <Card key={pid} player={playersById[pid]} aliveState={aliveState} currentPlayerId={currentPlayerId}
                  canWrite={canWrite} onToggleAlive={onToggleAlive} spawnGroups={spawnGroups}
                  spawnState={spawnState} onSetSpawn={onSetSpawn}
                  groupRoles={groupRoles} groupId={group.id} onSetRole={onSetRole}
                  groupColor={gColor} />
              ) : null
            )}
          </SortableContext>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAP NAV – Doppelklick zum Wechseln, Einfachklick nur Auswahl
// ─────────────────────────────────────────────────────────────

function MapNavPanel({ maps, pois, activeMapId, setActiveMapId, isAdmin, onRenameMap, onDeleteMap,
  onAddSubmap, onRenamePOI, onDeletePOI, onAddPOI, onSetMapImage,
}: {
  maps: MapEntry[]; pois: POI[]; activeMapId: string; setActiveMapId: (id: string) => void;
  isAdmin: boolean; onRenameMap: (id: string, label: string) => void; onDeleteMap: (id: string) => void;
  onAddSubmap: () => void; onRenamePOI: (id: string, label: string) => void;
  onDeletePOI: (id: string) => void; onAddPOI: (parentMapId: string) => void;
  onSetMapImage: (id: string, image: string) => void;
}) {
  const submaps = maps.filter((m) => m.id !== "main");
  return (
    <div className="space-y-1">
      <MapNavRow map={maps.find((m) => m.id === "main")!} activeMapId={activeMapId}
        setActiveMapId={setActiveMapId} isAdmin={isAdmin} canDelete={false}
        onRename={(v) => onRenameMap("main", v)} onDelete={() => {}}
        onSetImage={(img) => onSetMapImage("main", img)} indent={0} />
      {submaps.map((sm) => (
        <React.Fragment key={sm.id}>
          <MapNavRow map={sm} activeMapId={activeMapId} setActiveMapId={setActiveMapId}
            isAdmin={isAdmin} canDelete={isAdmin}
            onRename={(v) => onRenameMap(sm.id, v)} onDelete={() => onDeleteMap(sm.id)}
            onSetImage={(img) => onSetMapImage(sm.id, img)} indent={1} />
          {pois.filter((p) => p.parentMapId === sm.id).map((poi) => (
            <MapNavRow key={poi.id} map={{ ...poi, id: poi.id }} activeMapId={activeMapId}
              setActiveMapId={setActiveMapId} isAdmin={isAdmin} canDelete={isAdmin}
              onRename={(v) => onRenamePOI(poi.id, v)} onDelete={() => onDeletePOI(poi.id)}
              onSetImage={(img) => onSetMapImage(poi.id, img)} indent={2} isPOI />
          ))}
          {isAdmin && (
            <button className="ml-10 text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-600 hover:text-gray-300 hover:bg-gray-800"
              onClick={() => onAddPOI(sm.id)}>+ POI</button>
          )}
        </React.Fragment>
      ))}
      {isAdmin && (
        <button className="w-full mt-1 text-xs px-2 py-1 rounded-lg border border-gray-700 text-gray-500 hover:text-gray-300 hover:bg-gray-800"
          onClick={onAddSubmap}>+ Unterkarte</button>
      )}
    </div>
  );
}

function MapNavRow({ map, activeMapId, setActiveMapId, isAdmin, canDelete, onRename, onDelete, onSetImage, indent, isPOI }: {
  map: { id: string; label: string; image: string }; activeMapId: string;
  setActiveMapId: (id: string) => void; isAdmin: boolean; canDelete: boolean;
  onRename: (v: string) => void; onDelete: () => void; onSetImage: (img: string) => void;
  indent: number; isPOI?: boolean;
}) {
  const [showUrl, setShowUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(map.image);
  useEffect(() => setUrlDraft(map.image), [map.image]);

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
            {icon}
            {isAdmin && indent > 0 ? <InlineEdit value={map.label} onSave={onRename} /> : <span className="truncate">{map.label}</span>}
            <span className={`text-xs flex-shrink-0 ${map.image ? "text-green-600" : "text-gray-700"}`}>{map.image ? "●" : "○"}</span>
            {indent > 0 && <span className="text-gray-600 text-xs ml-auto">↵↵</span>}
          </span>
        </button>
        {isAdmin && (
          <button className={`text-xs px-1 flex-shrink-0 ${showUrl ? "text-blue-400" : "text-gray-600 hover:text-blue-400"}`}
            onClick={() => setShowUrl((v) => !v)} title="Bild-URL">🖼</button>
        )}
        {canDelete && (
          <button className="text-xs text-gray-600 hover:text-red-500 px-1 flex-shrink-0" onClick={onDelete}>✕</button>
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

// ─────────────────────────────────────────────────────────────
// TOKEN PLACER
// ─────────────────────────────────────────────────────────────

function TokenPlacerPanel({ groups, onPlace, activeMapId }: {
  groups: Group[]; onPlace: (gId: string, x: number, y: number, mapId: string) => void; activeMapId: string;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  const tactical = groups.filter((g) => g.id !== "unassigned" && !g.isSpawn);

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
      <div className="text-xs text-gray-500 mb-2">Karte: <span className="text-blue-400">{activeMapId}</span></div>
      {tactical.map((g) => (
        <button key={g.id}
          className={`w-full rounded-lg border px-2 py-1.5 mb-1 text-xs font-medium transition-colors flex items-center gap-2 ${
            armed === g.id ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"
          }`}
          onClick={(e) => { e.stopPropagation(); setArmed(g.id); }}>
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: groupColor(g) }} />
          {armed === g.id ? `▶ Klicke auf Karte…` : `Setze: ${g.label}`}
        </button>
      ))}
      {armed && (
        <button className="w-full rounded-lg border border-red-800 px-2 py-1.5 text-xs bg-red-950 text-red-400"
          onClick={(e) => { e.stopPropagation(); setArmed(null); }}>Abbrechen</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DRAWING TOOLBAR
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
  if (!canDraw) return null;

  const tools: { id: DrawTool; icon: string; title: string }[] = [
    { id: "pointer", icon: "↖", title: "Zeiger (normal)" },
    { id: "pen",     icon: "✏", title: "Freihand zeichnen" },
    { id: "line",    icon: "╱", title: "Linie ziehen" },
    { id: "eraser",  icon: "⌫", title: "Radiergummi" },
    { id: "text",    icon: "T", title: "Text einfügen" },
  ];

  return (
    <div
      className="absolute left-1/2 z-30 flex items-center gap-2 bg-gray-900 bg-opacity-95 border border-gray-700 rounded-2xl px-3 py-2 shadow-xl select-none"
      style={{ bottom: 16, transform: "translateX(-50%)" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Tools */}
      <div className="flex gap-1">
        {tools.map((t) => (
          <button key={t.id}
            title={t.title}
            onClick={() => setTool(t.id)}
            className={`w-8 h-8 rounded-lg text-sm font-bold border transition-colors ${
              tool === t.id
                ? "bg-blue-600 border-blue-400 text-white"
                : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"
            }`}>
            {t.icon}
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-gray-700" />

      {/* Farben */}
      <div className="flex gap-1">
        {DRAW_COLORS.map((c) => (
          <button key={c}
            title={c}
            onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
              color === c ? "border-white scale-125" : "border-transparent"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="w-px h-6 bg-gray-700" />

      {/* Strichstärke */}
      <div className="flex gap-1 items-center">
        {DRAW_WIDTHS.map((w) => (
          <button key={w}
            title={`${w}px`}
            onClick={() => setWidth(w)}
            className={`rounded border flex items-center justify-center transition-colors ${
              width === w ? "border-blue-400 bg-blue-900" : "border-gray-600 bg-gray-800 hover:bg-gray-700"
            }`}
            style={{ width: 28, height: 28 }}>
            <div className="rounded-full bg-white" style={{ width: Math.min(w * 1.5, 20), height: Math.min(w * 1.5, 20) }} />
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-gray-700" />

      {/* Undo / Clear */}
      <button title="Rückgängig" onClick={onUndo}
        className="w-8 h-8 rounded-lg text-sm border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700">
        ↩
      </button>
      <button title="Alles löschen" onClick={onClear}
        className="w-8 h-8 rounded-lg text-sm border border-red-900 bg-red-950 text-red-400 hover:bg-red-900">
        🗑
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DRAWING LAYER  (SVG über dem Kartenbild, unter Tokens)
// ─────────────────────────────────────────────────────────────

function DrawingLayer({
  elements, tool, color, strokeWidth, canDraw, scale, offset,
  onAddElement, onRemoveElement,
}: {
  elements: DrawElement[];
  tool: DrawTool; color: string; strokeWidth: number;
  canDraw: boolean; scale: number; offset: { x: number; y: number };
  onAddElement: (el: DrawElement) => void;
  onRemoveElement: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);
  const currentPath = useRef<string>("");
  const lineStart = useRef<{ x: number; y: number } | null>(null);
  const [liveStroke, setLiveStroke] = useState<string>("");
  const [liveLine, setLiveLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  // Text-Eingabe
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null);
  const [textVal, setTextVal] = useState("");
  const textRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (textInput && textRef.current) textRef.current.focus(); }, [textInput]);

  // Koordinaten normalisieren: Pixel → 0–1 relativ zur SVG-Größe
  function toRel(e: React.PointerEvent): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top)  / rect.height,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!canDraw || tool === "pointer") return;
    e.stopPropagation();

    const p = toRel(e);
    if (!p) return;

    if (tool === "text") {
      setTextInput(p);
      setTextVal("");
      return;
    }

    if (tool === "eraser") {
      // Lösche alle Elemente die nah am Klickpunkt liegen
      const thresh = 0.03 / scale;
      for (const el of elements) {
        if (el.type === "path") {
          // Grobe Prüfung: parse erste M-Koordinate
          const m = el.d.match(/M([\d.]+),([\d.]+)/);
          if (m) {
            const ex = parseFloat(m[1]), ey = parseFloat(m[2]);
            if (Math.hypot(ex - p.x, ey - p.y) < thresh * 5) { onRemoveElement(el.id); return; }
          }
        } else if (el.type === "line") {
          const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
          if (Math.hypot(mx - p.x, my - p.y) < thresh * 5) { onRemoveElement(el.id); return; }
        } else if (el.type === "text") {
          if (Math.hypot(el.x - p.x, el.y - p.y) < thresh * 5) { onRemoveElement(el.id); return; }
        }
      }
      return;
    }

    if (tool === "pen") {
      drawing.current = true;
      currentPath.current = `M${p.x.toFixed(4)},${p.y.toFixed(4)}`;
      setLiveStroke(currentPath.current);
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "line") {
      lineStart.current = p;
      setLiveLine({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
      return;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!canDraw) return;
    const p = toRel(e);
    if (!p) return;

    if (tool === "eraser" && e.buttons === 1) {
      // Kontinuierliches Radieren beim Ziehen
      const thresh = 0.03 / scale;
      for (const el of elements) {
        if (el.type === "path") {
          const m = el.d.match(/M([\d.]+),([\d.]+)/);
          if (m) {
            const ex = parseFloat(m[1]), ey = parseFloat(m[2]);
            if (Math.hypot(ex - p.x, ey - p.y) < thresh * 5) { onRemoveElement(el.id); return; }
          }
        } else if (el.type === "line") {
          const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
          if (Math.hypot(mx - p.x, my - p.y) < thresh * 5) { onRemoveElement(el.id); return; }
        } else if (el.type === "text") {
          if (Math.hypot(el.x - p.x, el.y - p.y) < thresh * 5) { onRemoveElement(el.id); return; }
        }
      }
    }

    if (tool === "pen" && drawing.current) {
      currentPath.current += ` L${p.x.toFixed(4)},${p.y.toFixed(4)}`;
      setLiveStroke(currentPath.current);
    }

    if (tool === "line" && lineStart.current) {
      setLiveLine({ x1: lineStart.current.x, y1: lineStart.current.y, x2: p.x, y2: p.y });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!canDraw) return;
    const p = toRel(e);

    if (tool === "pen" && drawing.current) {
      drawing.current = false;
      if (currentPath.current.length > 10) {
        onAddElement({ id: uid(), type: "path", d: currentPath.current, color, width: strokeWidth });
      }
      setLiveStroke("");
      currentPath.current = "";
    }

    if (tool === "line" && lineStart.current && p) {
      onAddElement({ id: uid(), type: "line",
        x1: lineStart.current.x, y1: lineStart.current.y, x2: p.x, y2: p.y,
        color, width: strokeWidth });
      lineStart.current = null;
      setLiveLine(null);
    }
  }

  function commitText() {
    if (textVal.trim() && textInput) {
      onAddElement({ id: uid(), type: "text", x: textInput.x, y: textInput.y,
        text: textVal.trim(), color, size: Math.max(12, strokeWidth * 3) });
    }
    setTextInput(null);
    setTextVal("");
  }

  // SVG-Koordinate aus 0–1 Wert (SVG viewBox ist 0 0 1 1)
  const svgCursor =
    tool === "pointer" ? "default" :
    tool === "eraser"  ? "cell" :
    tool === "text"    ? "text" :
    "crosshair";

  return (
    <div className="absolute inset-0 z-5" style={{ pointerEvents: tool === "pointer" ? "none" : "auto" }}>
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{ cursor: svgCursor, overflow: "visible" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Gespeicherte Elemente */}
        {elements.map((el) => {
          if (el.type === "path") {
            return <path key={el.id} d={el.d} stroke={el.color} strokeWidth={el.width / 1000}
              fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
          }
          if (el.type === "line") {
            return <line key={el.id} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2}
              stroke={el.color} strokeWidth={el.width / 1000} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
          }
          if (el.type === "text") {
            return (
              <text key={el.id} x={el.x} y={el.y} fill={el.color}
                fontSize={el.size / 1000} fontFamily="Arial, sans-serif"
                dominantBaseline="hanging" vectorEffect="non-scaling-stroke"
                style={{ userSelect: "none" }}>
                {el.text}
              </text>
            );
          }
          return null;
        })}

        {/* Live-Stroke (während des Zeichnens) */}
        {liveStroke && (
          <path d={liveStroke} stroke={color} strokeWidth={strokeWidth / 1000}
            fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        )}
        {liveLine && (
          <line x1={liveLine.x1} y1={liveLine.y1} x2={liveLine.x2} y2={liveLine.y2}
            stroke={color} strokeWidth={strokeWidth / 1000} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      {/* Text-Eingabefeld */}
      {textInput && (
        <div className="absolute z-50 pointer-events-auto"
          style={{
            left: `${textInput.x * 100}%`,
            top:  `${textInput.y * 100}%`,
            transform: "translate(0, -2px)",
          }}>
          <input
            ref={textRef}
            className="bg-gray-900 bg-opacity-90 border border-blue-500 text-white text-sm px-2 py-1 rounded shadow-lg outline-none min-w-[120px]"
            style={{ color }}
            value={textVal}
            onChange={(e) => setTextVal(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") { setTextInput(null); setTextVal(""); }
            }}
            onBlur={commitText}
            placeholder="Text eingeben…"
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ZOOMABLE MAP
// BUGFIX: Mausrad = nur Scrollen/Panning, kein Zoom. Zoom nur über Buttons.
// ─────────────────────────────────────────────────────────────

function ZoomableMap({ imageSrc, tokens, groups, board, playersById, aliveState, groupRoles,
  onMoveTokenLocal, onCommitToken, canWriteTokens, isAdmin, markers, onOpenMarker,
  onCommitMarker, activeMapId, onRemoveToken,
  drawElements, drawTool, drawColor, drawWidth, canDraw, onAddDrawElement, onRemoveDrawElement,
}: {
  imageSrc: string; tokens: Token[]; groups: Group[]; board: BoardState;
  playersById: Record<string, Player>; aliveState: PlayerAliveState; groupRoles: GroupRoles;
  onMoveTokenLocal: (gId: string, x: number, y: number, mapId: string) => void;
  onCommitToken: (gId: string, x: number, y: number, mapId: string) => void;
  canWriteTokens: boolean; isAdmin: boolean;
  markers: Array<{ id: string; label: string; x: number; y: number; isPOI?: boolean }>;
  onOpenMarker: (id: string) => void; onCommitMarker: (id: string, x: number, y: number) => void;
  activeMapId: string; onRemoveToken: (gId: string, mapId: string) => void;
  drawElements: DrawElement[]; drawTool: DrawTool; drawColor: string; drawWidth: number;
  canDraw: boolean;
  onAddDrawElement: (el: DrawElement) => void;
  onRemoveDrawElement: (id: string) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [tokenDrag, setTokenDrag] = useState<string | null>(null);
  const [markerDrag, setMarkerDrag] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const lastTokenPos = useRef<{ x: number; y: number } | null>(null);
  const lastMarkerPos = useRef<{ x: number; y: number } | null>(null);
  const [hoveredToken, setHoveredToken] = useState<string | null>(null);
  // Double-click tracking for markers (stored outside render map)
  const markerClickCount = useRef<Record<string, number>>({});
  const markerClickTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function getMapCoords(e: React.PointerEvent) {
    const img = document.getElementById("map-img");
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  // BUGFIX: Mausrad → nur Panning (kein Zoom), Zoom nur über Buttons
  function onWheel(e: React.WheelEvent) {
    // Panning mit Mausrad: horizontal und vertikal
    setOffset((o) => ({ x: o.x - e.deltaX * 0.8, y: o.y - e.deltaY * 0.8 }));
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
    if (tokenDrag && canWriteTokens) {
      const c = getMapCoords(e);
      if (c) { lastTokenPos.current = c; const [gId] = tokenDrag.split(":"); onMoveTokenLocal(gId, c.x, c.y, activeMapId); }
    }
    if (markerDrag) {
      const c = getMapCoords(e);
      if (c) lastMarkerPos.current = c;
    }
  }

  function onBgUp() {
    if (tokenDrag && lastTokenPos.current && canWriteTokens) {
      const [gId] = tokenDrag.split(":");
      onCommitToken(gId, lastTokenPos.current.x, lastTokenPos.current.y, activeMapId);
    }
    if (markerDrag && lastMarkerPos.current) onCommitMarker(markerDrag, lastMarkerPos.current.x, lastMarkerPos.current.y);
    setPanning(false); setTokenDrag(null); lastTokenPos.current = null;
    setMarkerDrag(null); lastMarkerPos.current = null;
  }

  const visibleTokens = tokens.map(normalizeToken).filter((t) => (t.mapId ?? "main") === activeMapId);
  const groupById = (gId: string) => groups.find((g) => g.id === gId);
  const groupCount = (gId: string) => (board.columns[gId] ?? []).length;

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
    <div className="w-full h-full overflow-hidden relative"
      style={{ cursor: drawTool !== "pointer" && canDraw ? "crosshair" : panning ? "grabbing" : "grab" }}
      onWheel={onWheel}
      onPointerDown={(e) => { if (drawTool !== "pointer" && canDraw) return; onBgDown(e); }}
      onPointerMove={(e) => { if (drawTool !== "pointer" && canDraw) return; onBgMove(e); }}
      onPointerUp={(e)   => { if (drawTool !== "pointer" && canDraw) return; onBgUp(); }}>

      {/* Zoom-Buttons */}
      <div className="absolute bottom-16 right-4 z-30 flex flex-col gap-1">
        {[
          { lbl: "+", fn: () => setScale((s) => Math.min(8, s * 1.3)) },
          { lbl: "−", fn: () => setScale((s) => Math.max(0.3, s / 1.3)) },
          { lbl: "⊙", fn: () => { setScale(1); setOffset({ x: 0, y: 0 }); } },
        ].map((b) => (
          <button key={b.lbl} onClick={(e) => { e.stopPropagation(); b.fn(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-9 h-9 bg-gray-800 border border-gray-600 text-white rounded-lg text-sm font-bold hover:bg-gray-700 shadow">
            {b.lbl}
          </button>
        ))}
      </div>

      <div style={{
        transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`,
        transformOrigin: "center center",
        transition: panning || tokenDrag || markerDrag ? "none" : "transform 0.1s",
        width: "100%", height: "100%", position: "relative",
      }}>
        <img id="map-img" src={imageSrc} alt="Map" className="w-full h-full object-contain block select-none" draggable={false} />

        {/* Drawing Layer – über dem Bild, unter Tokens/Markern */}
        <DrawingLayer
          elements={drawElements}
          tool={drawTool}
          color={drawColor}
          strokeWidth={drawWidth}
          canDraw={canDraw}
          scale={scale}
          offset={offset}
          onAddElement={onAddDrawElement}
          onRemoveElement={onRemoveDrawElement}
        />

        {/* Marker – Doppelklick öffnet, Einfachklick / Drag verschiebt */}
        {/* markerClickCounters: id → count, stored outside map via closure */}
        {markers.map((m) => (
            <div key={m.id}
              className={`absolute z-10 flex items-center gap-1 ${isAdmin ? "cursor-move" : "cursor-pointer"}`}
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: "translate(-50%,-50%)" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (isAdmin) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setMarkerDrag(m.id); lastMarkerPos.current = null; }
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (markerDrag) return;
                // Doppelklick → Ebene wechseln
                markerClickCount.current[m.id] = (markerClickCount.current[m.id] ?? 0) + 1;
                if (markerClickTimer.current[m.id]) clearTimeout(markerClickTimer.current[m.id]);
                if (markerClickCount.current[m.id] >= 2) {
                  onOpenMarker(m.id); markerClickCount.current[m.id] = 0; return;
                }
                markerClickTimer.current[m.id] = setTimeout(() => { markerClickCount.current[m.id] = 0; }, 350);
              }}>
              <div className={`text-xs font-bold px-2 py-0.5 rounded-full border-2 shadow-lg select-none whitespace-nowrap ${
                m.isPOI ? "bg-blue-700 border-blue-400 text-white" : "bg-yellow-500 border-yellow-300 text-black"
              }`}>
                {m.isPOI ? "🔵" : "📍"} {m.label}
                {isAdmin && <span className="ml-1 opacity-50">↵↵</span>}
              </div>
            </div>
        ))}

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
              style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, transform: "translate(-50%,-50%)" }}
              onPointerDown={(e) => {
                if (!canWriteTokens) return;
                // Kein Drag starten wenn auf ✕ geklickt
                if ((e.target as HTMLElement).dataset.removeBtn) return;
                e.stopPropagation();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                setTokenDrag(tokenKey); lastTokenPos.current = null;
              }}
              onMouseEnter={() => setHoveredToken(tokenKey)}
              onMouseLeave={() => setHoveredToken(null)}
              title={canWriteTokens ? "Ziehen  ·  ✕ zum Entfernen" : "Nur Ansicht"}>
              {/* Token-Pille */}
              <div className="relative">
                <div className={`px-3 py-1 rounded-full border-2 shadow-lg whitespace-nowrap`}
                  style={{
                    backgroundColor: tokenDrag === tokenKey ? "#eab308" : color,
                    borderColor: tokenDrag === tokenKey ? "#fde047" : "white",
                    color: tokenDrag === tokenKey ? "black" : "white",
                  }}>
                  <span className="font-bold text-sm">{g?.label ?? t.groupId}</span>
                  <span className="ml-1.5 text-xs font-normal opacity-80">{count}</span>
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
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NOTES PANEL
// ─────────────────────────────────────────────────────────────

function NotesPanel({ x, y, w, h, text, onChange, onMove, onResize, canWrite }: {
  x: number; y: number; w: number; h: number; text: string;
  onChange: (t: string) => void; onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void; canWrite: boolean;
}) {
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
    onMove(Math.max(0, start.current.px + e.clientX - start.current.mx), Math.max(0, start.current.py + e.clientY - start.current.my));
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
    <div className="absolute z-20 rounded-xl border border-gray-600 bg-gray-900 bg-opacity-95 shadow-xl flex flex-col overflow-hidden"
      style={{ left: x, top: y, width: w, height: h, minWidth: 180, minHeight: 120 }}
      onPointerMove={(e) => { onHeaderMove(e); onResizeMove(e); }}
      onPointerUp={() => { onHeaderUp(); onResizeUp(); }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 bg-gray-800 select-none cursor-move flex-shrink-0"
        onPointerDown={onHeaderDown}>
        <span className="text-gray-500 text-xs">⠿</span>
        <span className="text-xs font-semibold text-gray-300 flex-1">📋 Notizen</span>
        <span className="text-gray-600 text-xs">{canWrite ? "schreibbar" : "lesend"}</span>
      </div>
      <textarea className="flex-1 bg-transparent text-gray-200 text-xs px-3 py-2 resize-none focus:outline-none placeholder-gray-600 font-mono"
        placeholder={canWrite ? "Notizen, Protokoll, Befehle…" : ""}
        value={text} readOnly={!canWrite} onChange={(e) => canWrite && onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()} style={{ cursor: canWrite ? "text" : "default" }} spellCheck={false} />
      <div className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-center justify-center text-gray-600 hover:text-gray-400 select-none"
        onPointerDown={onResizeDown} title="Größe ändern">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M10 0L0 10h2L10 2V0zm0 4L4 10h2l4-4V4zm0 4l-2 2h2V8z"/>
        </svg>
      </div>
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
  const roomId = searchParams.get("room") || "default";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [role, setRole] = useState<Role>("viewer");

  const [players, setPlayers] = useState<Player[]>([]);
  const [board, setBoard] = useState<BoardState>({
    groups: DEFAULT_GROUPS,
    columns: Object.fromEntries(DEFAULT_GROUPS.map((g) => [g.id, []])),
  });
  const [groupRoles, setGroupRoles] = useState<GroupRoles>({});

  const [tokens, setTokens] = useState<Token[]>([]);
  const [aliveState, setAliveState] = useState<PlayerAliveState>({});
  const [spawnState, setSpawnState] = useState<PlayerSpawnState>({});
  const [maps, setMaps] = useState<MapEntry[]>(DEFAULT_MAPS);
  const [pois, setPois] = useState<POI[]>([]);
  const [tab, setTab] = useState<"board" | "map">("board");
  const [activeMapId, setActiveMapId] = useState("main");
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(DEFAULT_PANEL_LAYOUT);
  const [notesText, setNotesText] = useState("");
  const [notesVisible, setNotesVisible] = useState(true);

  // Drawing state
  const [drawings, setDrawings] = useState<DrawingsMap>({});
  const [drawTool, setDrawTool] = useState<DrawTool>("pointer");
  const [drawColor, setDrawColor] = useState("#ffffff");
  const [drawWidth, setDrawWidth] = useState(4);
  const drawingsRef = useRef<DrawingsMap>({});

  const [sortField, setSortField] = useState<"name" | "area" | "role" | "squadron" | "homeLocation" | "aliveStatus" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  const playersById = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);
  const canWrite = role === "admin" || role === "commander";
  const isAdmin = role === "admin";

  // refs
  const boardRef = useRef(board);
  const aliveRef = useRef(aliveState);
  const spawnRef = useRef(spawnState);
  const mapsRef = useRef(maps);
  const poisRef = useRef(pois);
  const tokensRef = useRef(tokens);
  const notesRef = useRef(notesText);
  const groupRolesRef = useRef(groupRoles);

  useEffect(() => { boardRef.current = board; }, [board]);
  useEffect(() => { aliveRef.current = aliveState; }, [aliveState]);
  useEffect(() => { spawnRef.current = spawnState; }, [spawnState]);
  useEffect(() => { mapsRef.current = maps; }, [maps]);
  useEffect(() => { poisRef.current = pois; }, [pois]);
  useEffect(() => { tokensRef.current = tokens; }, [tokens]);
  useEffect(() => { notesRef.current = notesText; }, [notesText]);
  useEffect(() => { groupRolesRef.current = groupRoles; }, [groupRoles]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);

  // auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthReady(true); });
    return () => unsub();
  }, []);

  // csv
  useEffect(() => {
    loadPlayers().then((list) => {
      setPlayers(list);
      setBoard((prev) => {
        const all = new Set(Object.values(prev.columns).flat());
        const toAdd = list.map((p) => p.id).filter((id) => !all.has(id));
        if (!toAdd.length) return prev;
        return { ...prev, columns: { ...prev.columns, unassigned: [...(prev.columns.unassigned ?? []), ...toAdd] } };
      });
    });
  }, []);

  // role
  useEffect(() => {
    if (!user || !currentPlayer) return;
    const sheetRole = (currentPlayer.appRole ?? "viewer") as Role;
    setRole(sheetRole);
    setDoc(doc(db, "rooms", roomId, "members", user.uid), { role: sheetRole, name: currentPlayer.name }, { merge: true }).catch(console.error);
  }, [user, currentPlayer, roomId]);

  // snapshot
  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "rooms", roomId, "state", "board");
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      if (!data) return;
      const loadedGroups: Group[] = Array.isArray(data.groups) && data.groups.length > 0 ? data.groups : DEFAULT_GROUPS;
      setBoard(safeBoard(data, loadedGroups));
      const incomingTokens: Token[] = Array.isArray(data.tokens) ? data.tokens.map(normalizeToken) : [];
      setTokens(incomingTokens);
      setAliveState(data.aliveState ?? {});
      setSpawnState(data.spawnState ?? {});
      if (data.maps && data.maps.length > 0) setMaps(data.maps);
      setPois(data.pois ?? []);
      if (data.panelLayout) setPanelLayout(data.panelLayout);
      if (typeof data.notesText === "string") setNotesText(data.notesText);
      if (data.groupRoles) setGroupRoles(data.groupRoles);
      if (data.drawings) setDrawings(data.drawings);
    });
    return () => unsub();
  }, [user, roomId]);

  // writes
  async function pushTokensOnly(nt: Token[]) {
    const ref = doc(db, "rooms", roomId, "state", "board");
    try { await updateDoc(ref, { tokens: nt, updatedAt: serverTimestamp() }); }
    catch { await setDoc(ref, { tokens: nt, updatedAt: serverTimestamp() }, { merge: true }); }
  }

  async function pushAll(nb: BoardState, nt: Token[], na: PlayerAliveState, ns: PlayerSpawnState,
    nm: MapEntry[], np: POI[], nl?: PanelLayout, ngr?: GroupRoles) {
    try {
      await setDoc(doc(db, "rooms", roomId, "state", "board"), {
        groups: nb.groups, columns: nb.columns, tokens: nt,
        aliveState: na, spawnState: ns, maps: nm, pois: np,
        ...(nl ? { panelLayout: nl } : {}),
        notesText: notesRef.current,
        groupRoles: ngr ?? groupRolesRef.current,
        drawings: drawingsRef.current,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) { console.error("Firestore:", err); }
  }

  // GroupRoles
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

  function movePanelNav(x: number, y: number) {
    if (!canWrite) return;
    const next = { ...panelLayout, nav: { x, y } };
    setPanelLayout(next);
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current, next);
  }

  function movePanelPlacer(x: number, y: number) {
    if (!canWrite) return;
    const next = { ...panelLayout, placer: { x, y } };
    setPanelLayout(next);
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current, next);
  }

  const notesMoveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function movePanelNotes(x: number, y: number) {
    const next = { ...panelLayout, notes: { ...panelLayout.notes, x, y } };
    setPanelLayout(next);
    if (notesMoveDebounce.current) clearTimeout(notesMoveDebounce.current);
    notesMoveDebounce.current = setTimeout(() => {
      pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current, next);
    }, 600);
  }

  const notesResizeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function resizePanelNotes(w: number, h: number) {
    const next = { ...panelLayout, notes: { ...panelLayout.notes, w, h } };
    setPanelLayout(next);
    if (notesResizeDebounce.current) clearTimeout(notesResizeDebounce.current);
    notesResizeDebounce.current = setTimeout(() => {
      pushAll(boardRef.current, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current, next);
    }, 600);
  }

  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleNotesChange(text: string) {
    setNotesText(text); notesRef.current = text;
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = setTimeout(() => {
      setDoc(doc(db, "rooms", roomId, "state", "board"), { notesText: text, updatedAt: serverTimestamp() }, { merge: true }).catch(console.error);
    }, 800);
  }

  function toggleAlive(playerId: string) {
    if (!currentPlayer) return;
    if (playerId !== currentPlayer.id && !canWrite) return;
    setAliveState((prev) => {
      const wasDead = prev[playerId] === "dead";
      const next = { ...prev, [playerId]: wasDead ? "alive" : "dead" } as PlayerAliveState;
      let nextBoard = boardRef.current;
      if (!wasDead) {
        const targetSpawnId = spawnRef.current[playerId];
        const targetSpawn = targetSpawnId ? nextBoard.groups.find((g) => g.id === targetSpawnId) : nextBoard.groups.find((g) => g.isSpawn);
        if (targetSpawn) {
          const newCols = { ...nextBoard.columns };
          for (const gId of Object.keys(newCols)) newCols[gId] = (newCols[gId] ?? []).filter((id) => id !== playerId);
          newCols[targetSpawn.id] = [playerId, ...(newCols[targetSpawn.id] ?? [])];
          nextBoard = { ...nextBoard, columns: newCols };
          setBoard(nextBoard); boardRef.current = nextBoard;
        }
      }
      pushAll(nextBoard, tokensRef.current, next, spawnRef.current, mapsRef.current, poisRef.current);
      return next;
    });
  }

  function setSpawn(playerId: string, spawnId: string) {
    const next = { ...spawnRef.current, [playerId]: spawnId };
    setSpawnState(next); spawnRef.current = next;
    pushAll(boardRef.current, tokensRef.current, aliveRef.current, next, mapsRef.current, poisRef.current);
  }

  function addGroup(isSpawn = false) {
    if (!canWrite) return;
    const g: Group = { id: uid(), label: isSpawn ? "Spawn" : "Neue Gruppe", isSpawn };
    setBoard((prev) => {
      const next = { groups: [...prev.groups, g], columns: { ...prev.columns, [g.id]: [] } };
      boardRef.current = next;
      pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
      return next;
    });
  }

  function renameGroup(id: string, label: string) {
    if (!canWrite) return;
    setBoard((prev) => {
      const next = { ...prev, groups: prev.groups.map((g) => g.id === id ? { ...g, label } : g) };
      boardRef.current = next;
      pushAll(next, tokensRef.current, aliveRef.current, spawnRef.current, mapsRef.current, poisRef.current);
      return next;
    });
  }

  function deleteGroup(id: string) {
    if (!canWrite || id === "unassigned") return;
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
    setTokens((prev) => {
      const i = prev.findIndex((t) => t.groupId === gId && (t.mapId ?? "main") === mapId);
      return i === -1 ? [...prev, { groupId: gId, x, y, mapId }] : prev.map((t, idx) => idx === i ? { ...t, x, y, mapId } : t);
    });
  }

  function commitToken(gId: string, x: number, y: number, mapId: string) {
    const prev = tokensRef.current.map(normalizeToken);
    const i = prev.findIndex((t) => t.groupId === gId && (t.mapId ?? "main") === mapId);
    const next = i === -1 ? [...prev, { groupId: gId, x, y, mapId }] : prev.map((t, idx) => idx === i ? { ...t, x, y, mapId } : t);
    setTokens(next); tokensRef.current = next; pushTokensOnly(next);
  }

  const upsertToken = useCallback((gId: string, x: number, y: number, mapId: string) => { commitToken(gId, x, y, mapId); }, []);

  function removeToken(gId: string, mapId: string) {
    if (!canWrite) return;
    const next = tokensRef.current.filter((t) => !(t.groupId === gId && (t.mapId ?? "main") === mapId));
    setTokens(next); tokensRef.current = next; pushTokensOnly(next);
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

  const activeMapEntry = maps.find((m) => m.id === activeMapId);
  const activePOI = pois.find((p) => p.id === activeMapId);
  const activeImage = normalizeImageUrl(activeMapEntry?.image ?? activePOI?.image ?? "");
  const activeLabel = activeMapEntry?.label ?? activePOI?.label ?? "";

  const markersOnActive = useMemo(() => {
    if (activeMapId === "main") return maps.filter((m) => m.id !== "main").map((m) => ({ id: m.id, label: m.label, x: m.x ?? 0.5, y: m.y ?? 0.5, isPOI: false }));
    return pois.filter((p) => p.parentMapId === activeMapId).map((p) => ({ id: p.id, label: p.label, x: p.x ?? 0.5, y: p.y ?? 0.5, isPOI: true }));
  }, [activeMapId, maps, pois]);

  function handleCommitMarker(id: string, x: number, y: number) {
    if (mapsRef.current.find((m) => m.id === id)) moveMapMarker(id, x, y);
    else movePOIMarker(id, x, y);
  }

  const breadcrumb = useMemo(() => {
    if (activeMapId === "main") return [{ id: "main", label: maps.find((m) => m.id === "main")?.label ?? "Hauptkarte" }];
    const sub = maps.find((m) => m.id === activeMapId);
    if (sub) return [{ id: "main", label: maps.find((m) => m.id === "main")?.label ?? "Hauptkarte" }, { id: sub.id, label: sub.label }];
    const poi = pois.find((p) => p.id === activeMapId);
    if (poi) {
      const parent = maps.find((m) => m.id === poi.parentMapId);
      return [
        { id: "main", label: maps.find((m) => m.id === "main")?.label ?? "Hauptkarte" },
        { id: poi.parentMapId, label: parent?.label ?? "Unterkarte" },
        { id: poi.id, label: poi.label },
      ];
    }
    return [{ id: "main", label: "Hauptkarte" }];
  }, [activeMapId, maps, pois]);

  const selfAlive = currentPlayer ? aliveState[currentPlayer.id] ?? "alive" : "alive";
  const spawnGroups = board.groups.filter((g) => g.isSpawn);
  const tacticalGroups = board.groups.filter((g) => g.id !== "unassigned" && !g.isSpawn);
  const unassignedGroup = board.groups.find((g) => g.id === "unassigned")!;

  if (!authReady) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">Laden…</div></div>
  );
  if (!user || !currentPlayer) return <LoginView onLogin={(p) => setCurrentPlayer(p)} />;

  const roleBadge =
    role === "admin" ? "bg-red-900 text-red-300 border border-red-700" :
    role === "commander" ? "bg-blue-900 text-blue-300 border border-blue-700" :
    "bg-gray-800 text-gray-400 border border-gray-600";

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <header className="flex-shrink-0 border-b border-gray-800 bg-gray-900 z-30">
        <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="font-bold text-white">TCS</span>
            <span className="text-xs text-gray-500 font-mono">Room: {roomId}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className={`px-4 py-2 rounded-lg border font-bold text-sm transition-colors ${
              selfAlive === "dead" ? "bg-red-900 border-red-600 text-red-200 hover:bg-red-800" : "bg-green-900 border-green-600 text-green-200 hover:bg-green-800"
            }`} onClick={() => toggleAlive(currentPlayer.id)}>
              {selfAlive === "dead" ? "☠ TOT" : "✓ LEBT"}
            </button>
            <span className="text-sm text-gray-300">{currentPlayer.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge}`}>{role}</span>
            {(["board", "map"] as const).map((t) => (
              <button key={t}
                className={`rounded-lg px-3 py-1.5 text-sm border transition-colors ${tab === t ? "bg-white text-black border-white" : "bg-transparent text-gray-300 border-gray-600 hover:border-gray-400"}`}
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

      {/* BOARD */}
      {tab === "board" && (
        <div className="flex-1 overflow-auto p-4">
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
                            groupColor="#6b7280" />
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
                    <DroppableColumn key={g.id} group={g} ids={board.columns[g.id] ?? []}
                      playersById={playersById} aliveState={aliveState} currentPlayerId={currentPlayer.id}
                      canWrite={canWrite} onToggleAlive={toggleAlive} onRename={renameGroup}
                      onDelete={deleteGroup} onClear={() => clearGroup(g.id)}
                      spawnGroups={spawnGroups} spawnState={spawnState} onSetSpawn={setSpawn}
                      groupRoles={groupRoles} onSetRole={setGroupRole} onSetColor={setGroupColor} />
                  ))}
                  {canWrite && (
                    <div className="flex flex-col gap-2">
                      <button className="text-xs px-3 py-2 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800 whitespace-nowrap" onClick={() => addGroup(false)}>+ Gruppe</button>
                      <button className="text-xs px-3 py-2 rounded-xl border border-yellow-800 text-yellow-400 hover:bg-yellow-950 whitespace-nowrap" onClick={() => addGroup(true)}>⚓ Spawn</button>
                    </div>
                  )}
                </div>
              </SortableContext>
            </div>
          </DndContext>
        </div>
      )}

      {/* MAP */}
      {tab === "map" && (
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-gray-900 bg-opacity-80 rounded-lg px-3 py-1.5 text-sm">
            {breadcrumb.map((b, i) => (
              <React.Fragment key={b.id}>
                {i > 0 && <span className="text-gray-600">›</span>}
                <button className={`hover:text-white ${i === breadcrumb.length - 1 ? "text-white" : "text-gray-400"}`} onClick={() => setActiveMapId(b.id)}>
                  {b.label}
                </button>
              </React.Fragment>
            ))}
            {isAdmin && <span className="text-yellow-600 text-xs ml-2">✥</span>}
            <button className={`ml-2 text-xs px-2 py-0.5 rounded border transition-colors ${notesVisible ? "bg-gray-700 border-gray-500 text-gray-200" : "border-gray-700 text-gray-500 hover:text-gray-300"}`}
              onClick={() => setNotesVisible(v => !v)} title="Notizen ein/ausblenden">📋</button>
          </div>

          <div className="w-full h-full">
            {!activeImage ? (
              <AutoMap label={activeLabel} mapId={activeMapId} />
            ) : (
              <ZoomableMap imageSrc={activeImage} tokens={tokens} groups={board.groups} board={board}
                playersById={playersById} aliveState={aliveState} groupRoles={groupRoles}
                onMoveTokenLocal={moveTokenLocal} onCommitToken={commitToken}
                canWriteTokens={canWrite && drawTool === "pointer"}
                isAdmin={isAdmin} markers={markersOnActive}
                onOpenMarker={(id) => setActiveMapId(id)} onCommitMarker={handleCommitMarker}
                activeMapId={activeMapId} onRemoveToken={removeToken}
                drawElements={drawings[activeMapId] ?? []}
                drawTool={drawTool} drawColor={drawColor} drawWidth={drawWidth}
                canDraw={canWrite}
                onAddDrawElement={addDrawElement}
                onRemoveDrawElement={removeDrawElement}
              />
            )}
          </div>

          {/* Drawing Toolbar – nur wenn Bild vorhanden */}
          {activeImage && (
            <DrawingToolbar
              tool={drawTool} setTool={setDrawTool}
              color={drawColor} setColor={setDrawColor}
              width={drawWidth} setWidth={setDrawWidth}
              canDraw={canWrite}
              onUndo={undoDrawElement}
              onClear={clearDrawings}
            />
          )}

          <DraggablePanel title="Karten" canDrag={canWrite} x={panelLayout.nav.x} y={panelLayout.nav.y} onMove={movePanelNav}>
            <MapNavPanel maps={maps} pois={pois} activeMapId={activeMapId} setActiveMapId={setActiveMapId}
              isAdmin={isAdmin} onRenameMap={renameMap} onDeleteMap={deleteMap} onAddSubmap={addSubmap}
              onRenamePOI={renamePOI} onDeletePOI={deletePOI} onAddPOI={addPOI} onSetMapImage={setMapImage} />
          </DraggablePanel>

          {canWrite && (
            <DraggablePanel title="Token setzen" canDrag={canWrite} x={panelLayout.placer.x} y={panelLayout.placer.y} onMove={movePanelPlacer}>
              <TokenPlacerPanel groups={board.groups} onPlace={(gId, x, y, mapId) => upsertToken(gId, x, y, mapId)} activeMapId={activeMapId} />
            </DraggablePanel>
          )}

          {notesVisible && (
            <NotesPanel x={panelLayout.notes?.x ?? 300} y={panelLayout.notes?.y ?? 16}
              w={panelLayout.notes?.w ?? 320} h={panelLayout.notes?.h ?? 200}
              text={notesText} onChange={handleNotesChange}
              onMove={(nx, ny) => movePanelNotes(nx, ny)} onResize={(nw, nh) => resizePanelNotes(nw, nh)}
              canWrite={canWrite} />
          )}
        </div>
      )}
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
