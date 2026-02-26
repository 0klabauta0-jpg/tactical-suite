"use client";


// React-Hooks fur State und Effekte
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


// URL-Parameter (fur Room-ID)
import { useSearchParams } from "next/navigation";


// Firebase Datenbank und Auth
import { db, auth } from "@/lib/firebase";
import {
  doc, onSnapshot, setDoc, serverTimestamp
} from "firebase/firestore";
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, User
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
};


// Die moglichen Gruppen-IDs
type GroupId = "unassigned" | "g1" | "g2" | "g3";


// Der Board-State: jede Gruppe enthalt eine Liste von Spieler-IDs
type BoardState = Record<GroupId, string[]>;


// Ein Token auf der Karte (Gruppe + Position)
type Token = {
  groupId: Exclude<GroupId, "unassigned">;
  x: number; // 0 bis 1 (relativ zur Kartenbreite)
  y: number; // 0 bis 1 (relativ zur Kartenhohe)
};


// Rolle eines Nutzers im Room
type Role = "admin" | "commander" | "viewer";


// CSV-URL aus Umgebungsvariable
const SHEET_CSV_URL = process.env.NEXT_PUBLIC_SHEET_CSV_URL ?? "";


// ─────────────────────────────────────────────────────────────
// HILFSFUNKTIONEN
// ─────────────────────────────────────────────────────────────


// Wandelt eine CSV-Zeile in ein Player-Objekt um
// "row" ist ein Objekt mit Spaltennamen als Keys
function rowToPlayer(row: any, idx: number): Player | null {
  const name = (row["Spielername"] ?? row["Name"] ?? "").toString().trim();
  if (!name) return null; // leere Zeilen uberspringen
  return {
    id: row["PlayerId"]?.toString().trim() ||
        `p_${idx}_${name.replace(/\s+/g, "_")}`,
    name,
    area:     (row["Bereich"]  ?? "").toString(),
    role:     (row["Rolle"]    ?? "").toString(),
    squadron: (row["Staffel"]  ?? "").toString(),
    status:   (row["Status"]   ?? "").toString(),
    ampel:    (row["Ampel"]    ?? "").toString(),
  };
}


// Ampel-Farbe: gut=grun, mittel=gelb, sonst=rot
function ampelColor(ampel?: string): string {
  if (ampel === "gut")    return "#16a34a";
  if (ampel === "mittel") return "#ca8a04";
  return "#dc2626";
}


// ─────────────────────────────────────────────────────────────
// KOMPONENTEN
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
      className="rounded-xl border bg-white p-2 shadow-sm cursor-grab active:cursor-grabbing"
    >
      {/* Farbiger Balken links je nach Ampel */}
      <div style={{ borderLeft: `3px solid ${ampelColor(player.ampel)}`, paddingLeft: 6 }}>
        <div className="font-semibold text-sm">{player.name}</div>
        <div className="text-xs text-gray-500">
          {player.area} {player.role ? `· ${player.role}` : ""}
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
  canWrite: boolean; // Schreibrecht
}) {
  const { setNodeRef, isOver } = useDroppable({ id });


  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border p-3 shadow-sm min-h-[300px] transition-colors
        ${isOver ? "bg-blue-50 border-blue-300" : "bg-gray-50"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">
          {title}
          <span className="ml-1 text-gray-400 font-normal">({ids.length})</span>
        </div>
        {onClear && canWrite ? (
          <button className="text-xs text-gray-500 hover:text-red-500" onClick={onClear}>
            leeren
          </button>
        ) : null}
      </div>


      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="space-y-1 min-h-[150px]">
          {ids.length === 0 ? (
            <div className="text-xs text-gray-400 border border-dashed rounded-lg p-4 text-center">
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
    if (!canWrite) return; // Viewer darf nicht ziehen
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(groupId);
  }


  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const img = document.getElementById("pyro-map");
    if (!img) return;
    const rect = img.getBoundingClientRect();
    onMoveToken(dragging, clamp((e.clientX-rect.left)/rect.width),
                          clamp((e.clientY-rect.top)/rect.height));
  }


  function onPointerUp() { setDragging(null); }


  return (
    <div className="relative select-none" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {/* Das Kartenbild – muss in public/pyro-map.png liegen */}
      <img id="pyro-map" src="/pyro-map.png" alt="Pyro Map"
           className="w-full h-auto block rounded-xl" />


      {/* Token fur jede Gruppe */}
      {tokens.map(t => (
        <div key={t.groupId}
          className={`absolute rounded-full border-2 bg-black text-white
            px-2 py-0.5 text-xs font-bold shadow-lg select-none
            ${canWrite ? "cursor-grab active:cursor-grabbing" : "cursor-default"}
            ${dragging === t.groupId ? "ring-2 ring-yellow-400 scale-110" : ""}
          `}
          style={{
            left: `${t.x*100}%`, top: `${t.y*100}%`,
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
  onPlace: (g: Exclude<GroupId,"unassigned">, x: number, y: number) => void;
}) {
  const [armed, setArmed] = useState<Exclude<GroupId,"unassigned">|null>(null);


  useEffect(() => {
    function handler(ev: MouseEvent) {
      const el = document.getElementById("pyro-map");
      if (!el || !armed) return;
      const rect = el.getBoundingClientRect();
      const x = (ev.clientX-rect.left)/rect.width;
      const y = (ev.clientY-rect.top)/rect.height;
      if (x>=0 && x<=1 && y>=0 && y<=1) {
        onPlace(armed, x, y);
        setArmed(null);
      }
    }
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [armed, onPlace]);


  const btn = (id: Exclude<GroupId,"unassigned">, label: string) => (
    <button key={id}
      className={`w-full rounded-lg border px-3 py-2 mb-1 text-sm font-medium
        ${armed===id ? "bg-black text-white" : "bg-white hover:bg-gray-50"}`}
      onClick={e => { e.stopPropagation(); setArmed(id); }}
    >
      {armed===id ? `Klick auf Karte: ${label}` : `Setze ${label}`}
    </button>
  );


  return (
    <div>
      {btn("g1","Gruppe 1")}
      {btn("g2","Gruppe 2")}
      {btn("g3","Gruppe 3")}
      {armed ? (
        <button className="w-full rounded-lg border px-3 py-2 text-sm bg-red-50 text-red-700"
          onClick={e => { e.stopPropagation(); setArmed(null); }}
        >Abbrechen</button>
      ) : null}
    </div>
  );
}


// Login-Formular
function LoginView() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");


  async function login() {
    setMsg("");
    try {
      await signInWithEmailAndPassword(auth, email, pw);
    } catch(e: any) { setMsg(e?.message ?? "Fehler"); }
  }


  async function register() {
    setMsg("");
    try {
      await createUserWithEmailAndPassword(auth, email, pw);
    } catch(e: any) { setMsg(e?.message ?? "Fehler"); }
  }


  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl border p-8 w-full max-w-sm shadow-sm">
        <h1 className="font-bold text-xl mb-6">Tactical Command Suite</h1>
        <input className="w-full border rounded-lg px-3 py-2 mb-3 text-sm"
          placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="w-full border rounded-lg px-3 py-2 mb-4 text-sm"
          type="password" placeholder="Passwort" value={pw}
          onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&login()} />
        <div className="flex gap-2">
          <button className="flex-1 bg-black text-white rounded-lg py-2 text-sm" onClick={login}>
            Einloggen
          </button>
          <button className="flex-1 border rounded-lg py-2 text-sm" onClick={register}>
            Registrieren
          </button>
        </div>
        {msg ? <p className="mt-3 text-red-600 text-xs">{msg}</p> : null}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// HAUPT-APP (wird in Suspense gewrappt – benotigt fur useSearchParams)
// ─────────────────────────────────────────────────────────────


function BoardApp() {
  // URL-Parameter lesen (z.B. ?room=pyro1)
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room") || "default";


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );


  // ── State ────────────────────────────────────────────────
  const [user,      setUser]      = useState<User|null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [role,      setRole]      = useState<Role>("viewer");
  const [players,   setPlayers]   = useState<Player[]>([]);
  const [board,     setBoard]     = useState<BoardState>({
    unassigned:[], g1:[], g2:[], g3:[]
  });
  const [tokens,    setTokens]    = useState<Token[]>([]);
  const [tab,       setTab]       = useState<"board"|"map">("board");


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


  // ── Rolle aus Firestore lesen ────────────────────────────
  useEffect(() => {
    if (!user) return;
    // Liest rooms/{roomId}/members/{uid}
    const ref = doc(db, "rooms", roomId, "members", user.uid);
    const unsub = onSnapshot(ref, snap => {
      const data = snap.data() as any;
      setRole((data?.role as Role) ?? "viewer");
    });
    return () => unsub();
  }, [user, roomId]);


  // ── Spieler aus CSV laden ────────────────────────────────
  useEffect(() => {
    if (!SHEET_CSV_URL.startsWith("http")) return;
    async function load() {
      const res  = await fetch(SHEET_CSV_URL, { cache: "no-store" });
      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const list: Player[] = [];
      (parsed.data as any[]).forEach((r, idx) => {
        const p = rowToPlayer(r, idx);
        if (p) list.push(p);
      });
      setPlayers(list);
      // Neue Spieler in Unassigned eintragen (nur wenn noch nicht zugewiesen)
      setBoard(prev => {
        const all = new Set(Object.values(prev).flat());
        const toAdd = list.map(p=>p.id).filter(id=>!all.has(id));
        if (!toAdd.length) return prev;
        return { ...prev, unassigned: [...prev.unassigned, ...toAdd] };
      });
    }
    load();
  }, []);


  // ── Firestore Live-Sync ──────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "rooms", roomId, "state", "board");
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
    if (!canWrite) return; // Viewer darf nicht schreiben
    try {
      const ref = doc(db, "rooms", roomId, "state", "board");
      await setDoc(ref, {
        board:     nextBoard,
        tokens:    nextTokens,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch(err) {
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
      (["unassigned","g1","g2","g3"] as const).includes(overId as any)
        ? (overId as GroupId)
        : findContainer(overId);


    if (!from || !to) return;


    if (from === to) {
      // Reihenfolge innerhalb der Gruppe andern
      const oi = board[from].indexOf(activeId);
      const ni = board[from].indexOf(overId);
      if (oi!==-1 && ni!==-1 && oi!==ni) {
        setBoard(prev => {
          const next = {...prev, [from]: arrayMove(prev[from],oi,ni)};
          pushState(next, tokens);
          return next;
        });
      }
      return;
    }


    // Spieler in andere Gruppe verschieben
    setBoard(prev => {
      const next = {
        ...prev,
        [from]: prev[from].filter(x=>x!==activeId),
        [to]:   [activeId, ...prev[to]],
      };
      pushState(next, tokens);
      return next;
    });
  }


  function clearGroup(g: Exclude<GroupId,"unassigned">) {
    setBoard(prev => {
      const next: BoardState = {
        ...prev,
        unassigned: [...prev.unassigned, ...prev[g]],
        [g]: [],
      };
      const nextTokens = tokens.filter(t=>t.groupId!==g);
      pushState(next, nextTokens);
      setTokens(nextTokens);
      return next;
    });
  }


  function upsertToken(groupId: Exclude<GroupId,"unassigned">, x: number, y: number) {
    setTokens(prev => {
      const i = prev.findIndex(t=>t.groupId===groupId);
      const next = i===-1
        ? [...prev, {groupId,x,y}]
        : prev.map((t,idx)=>idx===i ? {groupId,x,y} : t);
      pushState(board, next);
      return next;
    });
  }


  // ── Render ──────────────────────────────────────────────


  // Warte auf Auth-Status
  if (!authReady) return <div className="p-8 text-gray-500">Laden...</div>;


  // Nicht eingeloggt → Login zeigen
  if (!user) return <LoginView />;


  return (
    <div className="min-h-screen bg-gray-50">


      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div>
            <span className="font-bold">Tactical Command Suite</span>
            <span className="ml-3 text-xs text-gray-500 font-mono">
              Room: {roomId}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Rolle anzeigen */}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium
              ${role==="admin" ? "bg-red-100 text-red-700" :
                role==="commander" ? "bg-blue-100 text-blue-700" :
                "bg-gray-100 text-gray-600"}`}
            >
              {role}
            </span>
            {/* Tab-Buttons */}
            {(["board","map"] as const).map(t => (
              <button key={t}
                className={`rounded-lg px-3 py-1.5 text-sm border
                  ${tab===t ? "bg-black text-white" : "bg-white"}`}
                onClick={() => setTab(t)}
              >
                {t === "board" ? "Board" : "Karte"}
              </button>
            ))}
            <button className="text-xs text-gray-500 hover:text-black"
              onClick={() => signOut(auth)}
            >
              Logout
            </button>
          </div>
        </div>
      </header>


      {/* Hauptinhalt */}
      <main className="mx-auto max-w-7xl px-4 py-6">


        {/* Board-Tab */}
        {tab === "board" && (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <DroppableColumn id="unassigned" title="Unzugeteilt"
                ids={board.unassigned} playersById={playersById} canWrite={canWrite} />
              <div className="md:col-span-3 grid grid-cols-3 gap-4">
                {(["g1","g2","g3"] as const).map(g => (
                  <DroppableColumn key={g} id={g}
                    title={g==="g1"?"Gruppe 1":g==="g2"?"Gruppe 2":"Gruppe 3"}
                    ids={board[g]} playersById={playersById}
                    canWrite={canWrite}
                    onClear={() => clearGroup(g)} />
                ))}
              </div>
            </div>
          </DndContext>
        )}


        {/* Karten-Tab */}
        {tab === "map" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border bg-white p-4">
              <div className="font-semibold mb-1 text-sm">Gruppen platzieren</div>
              <p className="text-xs text-gray-500 mb-3">
                Knopf klicken → auf Karte klicken. Danach Token ziehen.
              </p>
              {canWrite
                ? <MapPlacer onPlace={(g,x,y)=>upsertToken(g,x,y)} />
                : <p className="text-xs text-gray-400">Viewer kann nicht platzieren.</p>
              }
            </div>
            <div className="lg:col-span-3 rounded-xl border overflow-hidden">
              <MapView tokens={tokens}
                onMoveToken={(g,x,y)=>upsertToken(g as any,x,y)}
                canWrite={canWrite} />
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
    <Suspense fallback={<div className="p-8">Laden...</div>}>
      <BoardApp />
    </Suspense>
  );
}
