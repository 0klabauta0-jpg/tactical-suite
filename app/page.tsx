"use client";

// React-Hooks für State und Effekte
import React, { useEffect, useMemo, useState, Suspense } from "react";

// CSV-Parser Bibliothek
import Papa from "papaparse";

// Drag & Drop Bibliothek
import {
  DndContext, DragEndEvent, PointerSensor,
  useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// URL-Parameter (für Room-ID)
import { useSearchParams } from "next/navigation";

// Firebase Datenbank und Auth
import { db, auth } from "@/lib/firebase";
import {
  doc, onSnapshot, setDoc, serverTimestamp
} from "firebase/firestore";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  User,
} from "firebase/auth";

// ─────────────────────────────────────────────────────────────
// TYPEN
// ─────────────────────────────────────────────────────────────

// Ein Spieler aus dem Google Sheet
type Player = {
  id: string;
  name: string;
  area?: string;
  role?: string;
  squadron?: string;
  status?: string;
  ampel?: string;
  appRole?: string; // Rolle für die App (admin/commander/viewer)
};

// Die möglichen Gruppen-IDs
type GroupId = "unassigned" | "g1" | "g2" | "g3";

// Der Board-State: jede Gruppe enthält eine Liste von Spieler-IDs
type BoardState = Record<GroupId, string[]>;

// Ein Token auf der Karte (Gruppe + Position)
type Token = {
  groupId: Exclude<GroupId, "unassigned">;
  x: number; // 0 bis 1 (relativ zur Kartenbreite)
  y: number; // 0 bis 1 (relativ zur Kartenhöhe)
};

// Rolle eines Nutzers
type Role = "admin" | "commander" | "viewer";

// CSV-URL und Team-Passwort aus Umgebungsvariablen
const SHEET_CSV_URL   = process.env.NEXT_PUBLIC_SHEET_CSV_URL   ?? "";
const TEAM_PASSWORD   = process.env.NEXT_PUBLIC_TEAM_PASSWORD   ?? "";

// ─────────────────────────────────────────────────────────────
// CSV LADEN (einmalig, außerhalb der Komponente gecacht)
// ─────────────────────────────────────────────────────────────

// Gecachte Spielerliste damit wir beim Login nicht nochmal laden müssen
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
      id:       row["PlayerId"]?.toString().trim() || `p_${idx}_${name.replace(/\s+/g, "_")}`,
      name,
      area:     (row["Bereich"]   ?? "").toString(),
      role:     (row["Rolle"]     ?? "").toString(),
      squadron: (row["Staffel"]   ?? "").toString(),
      status:   (row["Status"]    ?? "").toString(),
      ampel:    (row["Ampel"]     ?? "").toString(),
      // AppRolle-Spalte bestimmt die App-Berechtigung
      appRole:  (row["AppRolle"]  ?? "viewer").toString().toLowerCase(),
    });
  });

  cachedPlayers = list;
  return list;
}

// ─────────────────────────────────────────────────────────────
// HILFSFUNKTIONEN
// ─────────────────────────────────────────────────────────────

// Firebase benötigt eine Email im Hintergrund – wir bauen sie aus dem Spielernamen
// Der User sieht das nie, es ist nur technisch nötig
function nameToFakeEmail(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${clean}@tcs.internal`;
}

// Ampel-Farbe: gut=grün, mittel=gelb, sonst=rot
function ampelColor(ampel?: string): string {
  if (ampel === "gut")    return "#16a34a";
  if (ampel === "mittel") return "#ca8a04";
  return "#dc2626";
}

// ─────────────────────────────────────────────────────────────
// LOGIN-KOMPONENTE
// ─────────────────────────────────────────────────────────────

function LoginView({ onLogin }: { onLogin: (player: Player) => void }) {
  const [playerName, setPlayerName] = useState("");
  const [password,   setPassword]   = useState("");
  const [msg,        setMsg]        = useState("");
  const [loading,    setLoading]    = useState(false);

  async function handleLogin() {
    setMsg("");
    setLoading(true);

    try {
      // 1. Team-Passwort prüfen
      if (password !== TEAM_PASSWORD) {
        setMsg("Falsches Team-Passwort.");
        setLoading(false);
        return;
      }

      // 2. Spielerliste laden und Namen suchen
      const players = await loadPlayers();
      const found   = players.find(
        p => p.name.toLowerCase() === playerName.trim().toLowerCase()
      );

      if (!found) {
        setMsg(`Spieler "${playerName}" nicht in der Liste gefunden.`);
        setLoading(false);
        return;
      }

      // 3. Firebase Auth: erst versuchen einzuloggen, sonst Account erstellen
      const fakeEmail = nameToFakeEmail(found.name);
      // Wir nutzen das Team-Passwort auch als Firebase-Passwort
      const firebasePw = TEAM_PASSWORD + "_tcs_internal";

      try {
        await signInWithEmailAndPassword(auth, fakeEmail, firebasePw);
      } catch {
        // Account existiert noch nicht → erstellen
        await createUserWithEmailAndPassword(auth, fakeEmail, firebasePw);
      }

      // 4. Login erfolgreich
      onLogin(found);

    } catch (e: any) {
      setMsg(e?.message ?? "Fehler beim Login.");
    }

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
          placeholder="z.B. KRT_Bjoern"
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
        />

        <label className="text-gray-300 text-xs mb-1 block">Team-Passwort</label>
        <input
          className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 mb-5 text-sm focus:outline-none focus:border-blue-500"
          type="password"
          placeholder="Team-Passwort"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
        />

        <button
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          onClick={handleLogin}
          disabled={loading || !playerName || !password}
        >
          {loading ? "Einloggen..." : "Einloggen"}
        </button>

        {msg ? (
          <p className="mt-3 text-red-400 text-xs">{msg}</p>
        ) : null}

        <p className="mt-4 text-gray-600 text-xs text-center">
          Spielername muss exakt wie im Sheet stehen.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// BOARD-KOMPONENTEN
// ─────────────────────────────────────────────────────────────

// Eine einzelne Spieler-Karte (draggable)
function Card({ player }: { player: Player }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: player.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="rounded-xl border border-gray-700 bg-gray-800 p-2 shadow-sm cursor-grab active:cursor-grabbing"
    >
      {/* Farbiger Balken links je nach Ampel */}
      <div style={{ borderLeft: `3px solid ${ampelColor(player.ampel)}`, paddingLeft: 6 }}>
        <div className="font-semibold text-sm text-white">{player.name}</div>
        <div className="text-xs text-gray-400">
          {player.area}{player.role ? ` · ${player.role}` : ""}
        </div>
      </div>
    </div>
  );
}

// Eine Gruppe-Spalte (droppable)
function DroppableColumn({
  id, title, ids, playersById, onClear, canWrite
}: {
  id: GroupId;
  title: string;
  ids: string[];
  playersById: Record<string, Player>;
  onClear?: () => void;
  canWrite: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border p-3 shadow-sm min-h-[300px] transition-colors
        ${isOver ? "bg-gray-700 border-blue-500" : "bg-gray-900 border-gray-700"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm text-white">
          {title}
          <span className="ml-1 text-gray-500 font-normal">({ids.length})</span>
        </div>
        {onClear && canWrite ? (
          <button className="text-xs text-gray-500 hover:text-red-400" onClick={onClear}>
            leeren
          </button>
        ) : null}
      </div>

      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="space-y-1 min-h-[150px]">
          {ids.length === 0 ? (
            <div className="text-xs text-gray-600 border border-dashed border-gray-700 rounded-lg p-4 text-center">
              hierher ziehen
            </div>
          ) : null}
          {ids.map(pid =>
            playersById[pid] ? <Card key={pid} player={playersById[pid]} /> : null
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// Karte mit Token-Anzeige
function MapView({
  tokens, onMoveToken, canWrite
}: {
  tokens: Token[];
  onMoveToken: (groupId: string, x: number, y: number) => void;
  canWrite: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);

  const label = (g: string) =>
    g === "g1" ? "G1" : g === "g2" ? "G2" : g === "g3" ? "G3" : g;

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  function onPointerDown(e: React.PointerEvent, groupId: string) {
    if (!canWrite) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(groupId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const img = document.getElementById("pyro-map");
    if (!img) return;
    const rect = img.getBoundingClientRect();
    onMoveToken(
      dragging,
      clamp((e.clientX - rect.left) / rect.width),
      clamp((e.clientY - rect.top)  / rect.height)
    );
  }

  function onPointerUp() { setDragging(null); }

  return (
    <div className="relative select-none" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <img
        id="pyro-map"
        src="/pyro-map.png"
        alt="Pyro Map"
        className="w-full h-auto block rounded-xl"
      />
      {tokens.map(t => (
        <div
          key={t.groupId}
          className={`absolute rounded-full border-2 border-white bg-blue-600 text-white
            px-2 py-0.5 text-xs font-bold shadow-lg select-none
            ${canWrite ? "cursor-grab active:cursor-grabbing" : "cursor-default"}
            ${dragging === t.groupId ? "ring-2 ring-yellow-400 scale-110" : ""}
          `}
          style={{
            left: `${t.x * 100}%`,
            top:  `${t.y * 100}%`,
            transform: "translate(-50%,-50%)",
          }}
          onPointerDown={e => onPointerDown(e, t.groupId)}
        >
          {label(t.groupId)}
        </div>
      ))}
    </div>
  );
}

// Token-Platzierungs-Panel
function MapPlacer({
  onPlace
}: {
  onPlace: (g: Exclude<GroupId, "unassigned">, x: number, y: number) => void;
}) {
  const [armed, setArmed] = useState<Exclude<GroupId, "unassigned"> | null>(null);

  useEffect(() => {
    function handler(ev: MouseEvent) {
      const el = document.getElementById("pyro-map");
      if (!el || !armed) return;
      const rect = el.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top)  / rect.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        onPlace(armed, x, y);
        setArmed(null);
      }
    }
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [armed, onPlace]);

  const btn = (id: Exclude<GroupId, "unassigned">, label: string) => (
    <button
      key={id}
      className={`w-full rounded-lg border px-3 py-2 mb-1 text-sm font-medium transition-colors
        ${armed === id
          ? "bg-blue-600 border-blue-500 text-white"
          : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"
        }`}
      onClick={e => { e.stopPropagation(); setArmed(id); }}
    >
      {armed === id ? `▶ Klick auf Karte…` : `Setze ${label}`}
    </button>
  );

  return (
    <div>
      {btn("g1", "Gruppe 1")}
      {btn("g2", "Gruppe 2")}
      {btn("g3", "Gruppe 3")}
      {armed ? (
        <button
          className="w-full rounded-lg border border-red-800 px-3 py-2 text-sm bg-red-950 text-red-400"
          onClick={e => { e.stopPropagation(); setArmed(null); }}
        >
          Abbrechen
        </button>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// HAUPT-APP
// ─────────────────────────────────────────────────────────────

function BoardApp() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room") || "default";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // ── State ────────────────────────────────────────────────
  const [user,        setUser]        = useState<User | null>(null);
  const [authReady,   setAuthReady]   = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [role,        setRole]        = useState<Role>("viewer");
  const [players,     setPlayers]     = useState<Player[]>([]);
  const [board,       setBoard]       = useState<BoardState>({
    unassigned: [], g1: [], g2: [], g3: []
  });
  const [tokens,      setTokens]      = useState<Token[]>([]);
  const [tab,         setTab]         = useState<"board" | "map">("board");

  // Schneller Lookup: id → Player
  const playersById = useMemo(
    () => Object.fromEntries(players.map(p => [p.id, p])),
    [players]
  );

  // Darf dieser User schreiben?
  const canWrite = role === "admin" || role === "commander";

  // ── Auth beobachten ──────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // ── Spieler aus CSV laden ────────────────────────────────
  useEffect(() => {
    loadPlayers().then(list => {
      setPlayers(list);
      // Neue Spieler in Unassigned eintragen (nur wenn noch nicht zugewiesen)
      setBoard(prev => {
        const all   = new Set(Object.values(prev).flat());
        const toAdd = list.map(p => p.id).filter(id => !all.has(id));
        if (!toAdd.length) return prev;
        return { ...prev, unassigned: [...prev.unassigned, ...toAdd] };
      });
    });
  }, []);

  // ── Nach Login: Rolle aus Sheet setzen + in Firestore speichern ──
  useEffect(() => {
    if (!user || !currentPlayer) return;

    // Rolle aus Sheet-Daten lesen
    const sheetRole = (currentPlayer.appRole ?? "viewer") as Role;
    setRole(sheetRole);

    // Rolle in Firestore speichern (damit Regeln greifen)
    const memberRef = doc(db, "rooms", roomId, "members", user.uid);
    setDoc(memberRef, { role: sheetRole, name: currentPlayer.name }, { merge: true })
      .catch(console.error);

  }, [user, currentPlayer, roomId]);

  // ── Firestore Live-Sync ──────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const ref  = doc(db, "rooms", roomId, "state", "board");
    const unsub = onSnapshot(ref, snap => {
      const data = snap.data() as any;
      if (!data) return;
      if (data.board)  setBoard(data.board);
      if (data.tokens) setTokens(data.tokens);
    });
    return () => unsub();
  }, [user, roomId]);

  // ── Firestore schreiben ──────────────────────────────────
  async function pushState(nextBoard: BoardState, nextTokens: Token[]) {
    if (!canWrite) return;
    try {
      const ref = doc(db, "rooms", roomId, "state", "board");
      await setDoc(ref, {
        board:     nextBoard,
        tokens:    nextTokens,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.error("Firestore Fehler:", err);
    }
  }

  // ── Drag & Drop Logik ────────────────────────────────────
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
      (["unassigned", "g1", "g2", "g3"] as const).includes(overId as any)
        ? (overId as GroupId)
        : findContainer(overId);

    if (!from || !to) return;

    if (from === to) {
      const oi = board[from].indexOf(activeId);
      const ni = board[from].indexOf(overId);
      if (oi !== -1 && ni !== -1 && oi !== ni) {
        setBoard(prev => {
          const next = { ...prev, [from]: arrayMove(prev[from], oi, ni) };
          pushState(next, tokens);
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
      pushState(next, tokens);
      return next;
    });
  }

  function clearGroup(g: Exclude<GroupId, "unassigned">) {
    setBoard(prev => {
      const next: BoardState = {
        ...prev,
        unassigned: [...prev.unassigned, ...prev[g]],
        [g]: [],
      };
      const nextTokens = tokens.filter(t => t.groupId !== g);
      pushState(next, nextTokens);
      setTokens(nextTokens);
      return next;
    });
  }

  function upsertToken(groupId: Exclude<GroupId, "unassigned">, x: number, y: number) {
    setTokens(prev => {
      const i    = prev.findIndex(t => t.groupId === groupId);
      const next = i === -1
        ? [...prev, { groupId, x, y }]
        : prev.map((t, idx) => idx === i ? { groupId, x, y } : t);
      pushState(board, next);
      return next;
    });
  }

  function handleLogout() {
    setCurrentPlayer(null);
    setRole("viewer");
    signOut(auth);
  }

  // ── Render ──────────────────────────────────────────────

  // Warte auf Firebase Auth-Status
  if (!authReady) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400">Laden...</div>
    </div>
  );

  // Nicht eingeloggt → Login zeigen
  if (!user || !currentPlayer) return (
    <LoginView onLogin={player => setCurrentPlayer(player)} />
  );

  // Rolle-Badge Farbe
  const roleBadge =
    role === "admin"     ? "bg-red-900 text-red-300 border border-red-700" :
    role === "commander" ? "bg-blue-900 text-blue-300 border border-blue-700" :
                           "bg-gray-800 text-gray-400 border border-gray-600";

  return (
    <div className="min-h-screen bg-gray-950">

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-white">TCS</span>
            <span className="text-xs text-gray-500 font-mono">Room: {roomId}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Eingeloggter Spieler */}
            <span className="text-sm text-gray-300">{currentPlayer.name}</span>
            {/* Rolle */}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge}`}>
              {role}
            </span>
            {/* Tab-Buttons */}
            {(["board", "map"] as const).map(t => (
              <button
                key={t}
                className={`rounded-lg px-3 py-1.5 text-sm border transition-colors
                  ${tab === t
                    ? "bg-white text-black border-white"
                    : "bg-transparent text-gray-300 border-gray-600 hover:border-gray-400"
                  }`}
                onClick={() => setTab(t)}
              >
                {t === "board" ? "Board" : "Karte"}
              </button>
            ))}
            <button
              className="text-xs text-gray-500 hover:text-gray-300"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Hauptinhalt */}
      <main className="mx-auto max-w-7xl px-4 py-6">

        {/* Viewer-Hinweis */}
        {!canWrite && (
          <div className="mb-4 rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-400">
            Du bist als <strong className="text-gray-300">Viewer</strong> eingeloggt – nur lesender Zugriff.
            Kontaktiere einen Admin um Commander-Rechte zu bekommen.
          </div>
        )}

        {/* Board-Tab */}
        {tab === "board" && (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <DroppableColumn
                id="unassigned" title="Unzugeteilt"
                ids={board.unassigned} playersById={playersById}
                canWrite={canWrite}
              />
              <div className="md:col-span-3 grid grid-cols-3 gap-4">
                {(["g1", "g2", "g3"] as const).map(g => (
                  <DroppableColumn
                    key={g} id={g}
                    title={g === "g1" ? "Gruppe 1" : g === "g2" ? "Gruppe 2" : "Gruppe 3"}
                    ids={board[g]} playersById={playersById}
                    canWrite={canWrite}
                    onClear={() => clearGroup(g)}
                  />
                ))}
              </div>
            </div>
          </DndContext>
        )}

        {/* Karten-Tab */}
        {tab === "map" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
              <div className="font-semibold mb-1 text-sm text-white">Gruppen platzieren</div>
              <p className="text-xs text-gray-500 mb-3">
                Knopf klicken → auf Karte klicken. Danach Token ziehen.
              </p>
              {canWrite
                ? <MapPlacer onPlace={(g, x, y) => upsertToken(g, x, y)} />
                : <p className="text-xs text-gray-600">Viewer kann nicht platzieren.</p>
              }
            </div>
            <div className="lg:col-span-3 rounded-xl border border-gray-700 overflow-hidden">
              <MapView
                tokens={tokens}
                onMoveToken={(g, x, y) => upsertToken(g as any, x, y)}
                canWrite={canWrite}
              />
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SEITEN-EXPORT
// useSearchParams() muss in <Suspense> stehen (Next.js Pflicht)
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
