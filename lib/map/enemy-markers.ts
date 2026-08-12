export type EnemyMarker = {
  id: string;
  type: "marker";
  kind: "infantry" | "ground" | "air";
  x: number;
  y: number;
  color: string;
  opacity: 1;
  createdAt: number;
};

export function normalizeEnemyMarker(value: unknown): EnemyMarker | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || item.type !== "marker") return null;
  if (item.kind !== "infantry" && item.kind !== "ground" && item.kind !== "air") return null;
  if (typeof item.x !== "number" || !Number.isFinite(item.x)
    || typeof item.y !== "number" || !Number.isFinite(item.y)) return null;
  return {
    id: item.id,
    type: "marker",
    kind: item.kind,
    x: item.x,
    y: item.y,
    color: typeof item.color === "string" ? item.color : "#ef4444",
    opacity: 1,
    createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
  };
}

export function enemyMarkerAgeLabel(createdAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? `${rest}m` : ""}`;
}
