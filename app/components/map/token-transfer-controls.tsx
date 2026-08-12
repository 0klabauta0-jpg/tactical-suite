"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import React, { createContext, useContext, useMemo, useState } from "react";
import { CSS } from "@dnd-kit/utilities";
import type { TokenLocation, TokenTransferIntent } from "@/lib/map/token-transfer";

export type TroopDragData = {
  type: "troop";
  groupId: string;
  label: string;
  color?: string;
  expectedSource: TokenLocation;
};

export type TokenDropData =
  | { type: "map2d"; mapId: string; imageElementId?: string }
  | { type: "child"; childId: string }
  | { type: "parent" };

type TransferRequest = {
  groupId: string;
  expectedSource: TokenLocation;
  intent: TokenTransferIntent;
};

type TroopTransferContextValue = {
  disabledGroups: ReadonlySet<string>;
};

const TroopTransferContext = createContext<TroopTransferContextValue>({
  disabledGroups: new Set<string>(),
});

const tokenCollisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const element = document
      .elementFromPoint(args.pointerCoordinates.x, args.pointerCoordinates.y)
      ?.closest<HTMLElement>("[data-token-drop-id]");
    const targetId = element?.dataset.tokenDropId;
    const target = targetId
      ? args.droppableContainers.find((container) => String(container.id) === targetId)
      : undefined;
    if (target) {
      return [{ id: target.id, data: { droppableContainer: target, value: 1 } }];
    }
  }

  const pointerCollisions = pointerWithin(args);
  const collisions = pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);
  const specificTarget = collisions.find((collision) => {
    const data = args.droppableContainers.find((container) => container.id === collision.id)?.data.current as TokenDropData | undefined;
    return data?.type === "child" || data?.type === "parent";
  });
  return specificTarget ? [specificTarget] : collisions;
};

function clampCoordinate(value: number) {
  return Math.max(0, Math.min(1, value));
}

function intentForDrop(event: DragEndEvent, drop: TokenDropData): TokenTransferIntent | null {
  if (drop.type === "child") return { kind: "enterChild", childId: drop.childId };
  if (drop.type === "parent") return { kind: "moveUp" };

  const translated = event.active.rect.current.translated;
  const targetRect = drop.imageElementId
    ? document.getElementById(drop.imageElementId)?.getBoundingClientRect()
    : event.over?.rect;
  if (!translated || !targetRect || targetRect.width <= 0 || targetRect.height <= 0) return null;

  return {
    kind: "place2d",
    mapId: drop.mapId,
    x: clampCoordinate((translated.left + translated.width / 2 - targetRect.left) / targetRect.width),
    y: clampCoordinate((translated.top + translated.height / 2 - targetRect.top) / targetRect.height),
  };
}

export function TroopTransferProvider({
  children,
  disabledGroups = new Set<string>(),
  onTransfer,
  onTransferError,
}: {
  children: React.ReactNode;
  disabledGroups?: ReadonlySet<string>;
  onTransfer: (request: TransferRequest) => Promise<void> | void;
  onTransferError?: (error: unknown) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const [activeTroop, setActiveTroop] = useState<TroopDragData | null>(null);
  const context = useMemo(() => ({ disabledGroups }), [disabledGroups]);

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as TroopDragData | undefined;
    setActiveTroop(data?.type === "troop" ? data : null);
  }

  function onDragEnd(event: DragEndEvent) {
    const troop = event.active.data.current as TroopDragData | undefined;
    const drop = event.over?.data.current as TokenDropData | undefined;
    setActiveTroop(null);
    if (troop?.type !== "troop" || !drop || disabledGroups.has(troop.groupId)) return;

    const intent = intentForDrop(event, drop);
    if (!intent) return;
    Promise.resolve(onTransfer({
      groupId: troop.groupId,
      expectedSource: troop.expectedSource,
      intent,
    })).catch((error: unknown) => onTransferError?.(error));
  }

  return (
    <TroopTransferContext.Provider value={context}>
      <DndContext
        sensors={sensors}
        collisionDetection={tokenCollisionDetection}
        onDragStart={onDragStart}
        onDragCancel={() => setActiveTroop(null)}
        onDragEnd={onDragEnd}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {activeTroop ? (
            <div
              className="rounded-full border border-white/70 bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white shadow-2xl"
              style={{ borderColor: activeTroop.color }}
            >
              {activeTroop.label}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </TroopTransferContext.Provider>
  );
}

export function DraggableTroopChip({
  groupId,
  label,
  color,
  expectedSource,
  testId = `troop-chip-${groupId}`,
  className = "",
}: {
  groupId: string;
  label: string;
  color?: string;
  expectedSource: TokenLocation;
  testId?: string;
  className?: string;
}) {
  const { disabledGroups } = useContext(TroopTransferContext);
  const disabled = disabledGroups.has(groupId);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `troop-${groupId}-${testId}`,
    disabled,
    data: { type: "troop", groupId, label, color, expectedSource } satisfies TroopDragData,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid={testId}
      data-troop-group-id={groupId}
      disabled={disabled}
      className={`touch-none select-none rounded-full border px-3 py-1.5 text-xs font-semibold shadow-lg ${disabled ? "cursor-wait opacity-50" : "cursor-grab active:cursor-grabbing"} ${className}`}
      style={{
        borderColor: color,
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.35 : undefined,
      }}
      {...listeners}
      {...attributes}
    >
      {label}
    </button>
  );
}

function dropAttribute(data: TokenDropData) {
  if (data.type === "child") return `child:${data.childId}`;
  if (data.type === "map2d") return `map2d:${data.mapId}`;
  return "parent";
}

export function useTokenDropTarget(id: string, data: TokenDropData) {
  const droppable = useDroppable({ id, data });
  return {
    ...droppable,
    dropTargetProps: {
      "data-token-drop-target": dropAttribute(data),
    } as const,
  };
}

export function TokenDropTarget({
  id,
  data,
  children,
  testId,
  className = "",
  ...elementProps
}: {
  id: string;
  data: TokenDropData;
  children: React.ReactNode;
  testId?: string;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "id">) {
  const { setNodeRef, isOver, dropTargetProps } = useTokenDropTarget(id, data);
  return (
    <div
      ref={setNodeRef}
      data-testid={testId}
      data-token-drop-id={id}
      className={`${className} ${isOver ? "ring-2 ring-cyan-300" : ""}`}
      {...elementProps}
      {...dropTargetProps}
    >
      {children}
    </div>
  );
}

export function ParentLevelDropTarget({
  className = "",
  parentLabel,
  testId = "move-up-target",
  onNavigate,
}: {
  className?: string;
  parentLabel?: string;
  testId?: string;
  onNavigate?: () => void;
}) {
  return (
    <TokenDropTarget
      id="token-parent-level"
      data={{ type: "parent" }}
      testId={testId}
      className={`rounded-xl border-2 border-dashed border-cyan-700 bg-cyan-950/80 px-4 py-3 text-center text-sm font-semibold text-cyan-100 ${className}`}
      role={onNavigate ? "button" : undefined}
      tabIndex={onNavigate ? 0 : undefined}
      aria-label={onNavigate ? `Eine Ebene hoch${parentLabel ? ` nach ${parentLabel}` : ""}` : undefined}
      onClick={onNavigate}
      onKeyDown={(event) => {
        if (!onNavigate || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onNavigate();
      }}
    >
      ↑ Eine Ebene hoch{parentLabel ? ` nach ${parentLabel}` : " ziehen"}
    </TokenDropTarget>
  );
}

export function tokenDropIntentForTargets(targets: readonly string[]): TokenTransferIntent | null {
  const target = targets.find((candidate) => candidate === "parent" || candidate.startsWith("child:"));
  if (target === "parent") return { kind: "moveUp" };
  if (target?.startsWith("child:")) return { kind: "enterChild", childId: target.slice("child:".length) };
  return null;
}

export function tokenDropIntentAtPoint(clientX: number, clientY: number): TokenTransferIntent | null {
  const targets = document.elementsFromPoint(clientX, clientY)
    .map((candidate) => candidate.closest<HTMLElement>("[data-token-drop-target]")?.dataset.tokenDropTarget)
    .filter((target): target is string => Boolean(target));
  return tokenDropIntentForTargets([...new Set(targets)]);
}
