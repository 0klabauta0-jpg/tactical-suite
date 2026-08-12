export type BoardGroup = {
  id: string;
  label: string;
  isSpawn?: boolean;
  color?: string;
  icon?: string;
  systemId?: string;
};

export type BoardState = {
  groups: BoardGroup[];
  columns: Record<string, string[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGroups(value: unknown, fallbackGroups: BoardGroup[]): BoardGroup[] {
  if (!Array.isArray(value)) return fallbackGroups;

  const groups = value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.label !== "string") return [];
    return [{
      id: candidate.id,
      label: candidate.label,
      ...(typeof candidate.isSpawn === "boolean" ? { isSpawn: candidate.isSpawn } : {}),
      ...(typeof candidate.color === "string" ? { color: candidate.color } : {}),
      ...(typeof candidate.icon === "string" ? { icon: candidate.icon } : {}),
      ...(typeof candidate.systemId === "string" ? { systemId: candidate.systemId } : {}),
    }];
  });
  return groups.length > 0 ? groups : fallbackGroups;
}

export function parseBoardState(value: unknown, fallbackGroups: BoardGroup[]): BoardState {
  const data = isRecord(value) ? value : {};
  const groups = parseGroups(data.groups, fallbackGroups);
  const rawColumns = isRecord(data.columns) ? data.columns : {};
  const columns: Record<string, string[]> = {};

  for (const group of groups) {
    const rawColumn = rawColumns[group.id];
    columns[group.id] = Array.isArray(rawColumn)
      ? rawColumn.filter((playerId): playerId is string => typeof playerId === "string")
      : [];
  }
  return { groups, columns };
}
