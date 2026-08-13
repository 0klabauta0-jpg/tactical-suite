"use client";

import type { RockbreakerDrawingTool } from "@/lib/rockbreaker/drawing";
import type { RockbreakerStrokeWidth } from "@/lib/rockbreaker/scene-objects";

const tools: Array<{ value: RockbreakerDrawingTool; label: string }> = [
  { value: "pointer", label: "Zeiger" },
  { value: "point", label: "Punkt setzen" },
  { value: "stroke", label: "Freihand zeichnen" },
  { value: "move", label: "Zeichnung verschieben" },
  { value: "delete", label: "Zeichnung löschen" },
];

const colors = [
  { value: "#22d3ee", label: "Farbe Türkis" },
  { value: "#ffffff", label: "Farbe Weiß" },
  { value: "#facc15", label: "Farbe Gelb" },
  { value: "#f87171", label: "Farbe Rot" },
];

const widths: RockbreakerStrokeWidth[] = [1, 3, 6];

export function RockbreakerDrawingControls(props: {
  tool: RockbreakerDrawingTool;
  color: string;
  width: RockbreakerStrokeWidth;
  canUndo: boolean;
  busy?: boolean;
  onToolChange: (tool: RockbreakerDrawingTool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: RockbreakerStrokeWidth) => void;
  onUndo: () => void;
}): React.ReactNode {
  const disabled = props.busy === true;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-1">
        {tools.map((tool) => (
          <button
            key={tool.value}
            type="button"
            className={`rounded border px-2 py-1.5 text-left text-xs ${props.tool === tool.value ? "border-cyan-400 bg-cyan-950 text-cyan-100" : "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"}`}
            aria-pressed={props.tool === tool.value}
            disabled={disabled}
            onClick={() => props.onToolChange(tool.value)}
          >
            {tool.label}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-1 text-xs text-gray-500">Farbe</p>
        <div className="grid grid-cols-4 gap-1">
          {colors.map((color) => (
            <button
              key={color.value}
              type="button"
              className={`h-8 rounded border ${props.color === color.value ? "border-cyan-300 ring-1 ring-cyan-300" : "border-gray-600"}`}
              style={{ backgroundColor: color.value }}
              aria-label={color.label}
              aria-pressed={props.color === color.value}
              disabled={disabled}
              onClick={() => props.onColorChange(color.value)}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-gray-500">Strichstärke</p>
        <div className="grid grid-cols-3 gap-1">
          {widths.map((width) => (
            <button
              key={width}
              type="button"
              className={`rounded border px-1 py-1.5 text-xs ${props.width === width ? "border-cyan-400 bg-cyan-950 text-cyan-100" : "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"}`}
              aria-label={`Strichstärke ${width}`}
              aria-pressed={props.width === width}
              disabled={disabled}
              onClick={() => props.onWidthChange(width)}
            >
              {width}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!props.canUndo || disabled}
        onClick={props.onUndo}
      >
        Eigene letzte Zeichnung rückgängig
      </button>
    </div>
  );
}
