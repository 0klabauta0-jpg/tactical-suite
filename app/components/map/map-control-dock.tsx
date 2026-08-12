"use client";

import React, { useRef } from "react";
import { clampDockY, toggleDockSection } from "@/lib/map/control-dock";
import type { MapControlSections, MapUiPreferences } from "@/lib/map/ui-preferences";

export type MapControlDockProps = {
  preferences: MapUiPreferences;
  onPreferencesChange: (next: MapUiPreferences) => void;
  maps: React.ReactNode;
  tokens: React.ReactNode;
  enemy?: React.ReactNode;
  drawing: React.ReactNode;
};

type SectionProps = {
  id: keyof MapControlSections;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

function DockSection({ id, label, open, onToggle, children }: SectionProps) {
  return (
    <section className="border-t border-gray-700 first:border-t-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 bg-gray-800 px-3 py-2 text-left text-xs font-semibold text-gray-200 hover:bg-gray-700"
        aria-label={`${label}bereich ${open ? "einklappen" : "ausklappen"}`}
        aria-expanded={open}
        aria-controls={`map-control-${id}`}
        onClick={onToggle}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span>{label}</span>
      </button>
      {open && (
        <div id={`map-control-${id}`} className="p-2">
          {children}
        </div>
      )}
    </section>
  );
}

export function MapControlDock({ preferences, onPreferencesChange, maps, tokens, enemy, drawing }: MapControlDockProps) {
  const dockRef = useRef<HTMLElement>(null);
  const drag = useRef({ active: false, pointerY: 0, dockY: 0 });

  function updateDockY(clientY: number) {
    const height = dockRef.current?.offsetHeight ?? 0;
    const nextY = clampDockY(
      drag.current.dockY + clientY - drag.current.pointerY,
      window.innerHeight,
      height,
    );
    onPreferencesChange({ ...preferences, dockY: nextY });
  }

  function onDragStart(event: React.PointerEvent<HTMLDivElement>) {
    drag.current = { active: true, pointerY: event.clientY, dockY: preferences.dockY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onDragMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    updateDockY(event.clientY);
  }

  function onDragEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    updateDockY(event.clientY);
    drag.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (preferences.dockCollapsed) {
    return (
      <aside
        ref={dockRef}
        aria-label="Kartensteuerung"
        data-collapsed="true"
        className="fixed right-0 z-50 rounded-l-xl border border-r-0 border-gray-600 bg-gray-900/95 shadow-2xl"
        style={{ top: preferences.dockY }}
      >
        <button
          type="button"
          className="flex h-12 w-9 items-center justify-center text-lg text-gray-200 hover:bg-gray-800"
          aria-label="Steuerleiste ausklappen"
          title="Kartensteuerung ausklappen"
          onClick={() => onPreferencesChange({ ...preferences, dockCollapsed: false })}
        >
          ‹
        </button>
      </aside>
    );
  }

  const sections: Array<{ id: keyof MapControlSections; label: string; content: React.ReactNode }> = [
    { id: "maps", label: "Karten", content: maps },
    ...(tokens === null || tokens === undefined ? [] : [{ id: "tokens" as const, label: "Token", content: tokens }]),
    ...(enemy === null || enemy === undefined ? [] : [{ id: "enemy" as const, label: "Feindmarker", content: enemy }]),
    ...(drawing === null || drawing === undefined ? [] : [{ id: "drawing" as const, label: "Zeichnen", content: drawing }]),
  ];

  return (
    <aside
      ref={dockRef}
      aria-label="Kartensteuerung"
      data-collapsed="false"
      className="fixed right-0 z-50 w-[min(280px,calc(100vw-16px))] overflow-hidden rounded-l-2xl border border-r-0 border-gray-600 bg-gray-900/95 shadow-2xl"
      style={{ top: preferences.dockY, maxHeight: `calc(100vh - ${preferences.dockY + 8}px)` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="flex cursor-ns-resize touch-none items-center gap-2 border-b border-gray-700 bg-gray-950 px-3 py-2 select-none"
        aria-label="Kartensteuerung vertikal verschieben"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span className="text-xs text-gray-500" aria-hidden="true">⠿</span>
        <span className="text-xs font-bold text-gray-200">Kartensteuerung</span>
        <button
          type="button"
          className={`ml-auto rounded border px-2 py-1 text-xs ${preferences.showGrid ? "border-green-600 bg-green-900 text-green-200" : "border-gray-700 text-gray-400 hover:bg-gray-800"}`}
          aria-label={preferences.showGrid ? "Grid ausschalten" : "Grid einschalten"}
          title={preferences.showGrid ? "Grid ausschalten" : "Grid einschalten"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onPreferencesChange({ ...preferences, showGrid: !preferences.showGrid })}
        >
          ⊞ Grid
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
          aria-label="Steuerleiste einklappen"
          title="Nach rechts einklappen"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onPreferencesChange({ ...preferences, dockCollapsed: true })}
        >
          ›
        </button>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: `calc(100vh - ${preferences.dockY + 48}px)` }}>
        {sections.map((section) => (
          <DockSection
            key={section.id}
            id={section.id}
            label={section.label}
            open={preferences.sections[section.id]}
            onToggle={() => onPreferencesChange(toggleDockSection(preferences, section.id))}
          >
            {section.content}
          </DockSection>
        ))}
      </div>
    </aside>
  );
}
