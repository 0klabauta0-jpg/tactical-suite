export type TokenLocationRemoval = {
  groupId: string;
  systemId: string;
  mapId: string;
  index: number;
  reason: "foreign-system" | "ancestor-shadow";
};

export type UnresolvedTokenLocation = {
  groupId: string;
  reason: "unknown-group" | "no-group-owned-location" | "ambiguous-group-owned-locations";
};

export type TokenLocationNormalization = {
  tokensBySystem: Record<string, unknown[]>;
  removals: TokenLocationRemoval[];
  unresolved: UnresolvedTokenLocation[];
};

type LocatedToken = {
  groupId: string;
  systemId: string;
  mapId: string;
  index: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function mapParents(board: Record<string, unknown>, systemId: string) {
  const parents = new Map<string, string | null>([["main", null]]);
  const bySystemMaps = isRecord(board.mapsBySystem) ? board.mapsBySystem : {};
  const rawMaps = Array.isArray(bySystemMaps[systemId]) ? bySystemMaps[systemId]
    : systemId === "pyro" && Array.isArray(board.maps) ? board.maps : [];
  for (const candidate of rawMaps) {
    if (!isRecord(candidate)) continue;
    const id = readString(candidate.id);
    if (!id) continue;
    const explicitParent = readString(candidate.parentMapId);
    parents.set(id, id === "main" ? null : explicitParent || "main");
  }

  const bySystemPois = isRecord(board.poisBySystem) ? board.poisBySystem : {};
  const rawPois = Array.isArray(bySystemPois[systemId]) ? bySystemPois[systemId]
    : systemId === "pyro" && Array.isArray(board.pois) ? board.pois : [];
  for (const candidate of rawPois) {
    if (!isRecord(candidate)) continue;
    const id = readString(candidate.id);
    const parent = readString(candidate.parentMapId);
    if (id && parent) parents.set(id, parent);
  }
  return parents;
}

function isStrictAncestor(ancestorId: string, descendantId: string, parents: ReadonlyMap<string, string | null>) {
  if (ancestorId === descendantId) return false;
  const visited = new Set<string>();
  let current: string | null | undefined = descendantId;
  while (current && !visited.has(current)) {
    visited.add(current);
    current = parents.get(current);
    if (current === ancestorId) return true;
  }
  return false;
}

function uniqueDeepest(tokens: readonly LocatedToken[], parents: ReadonlyMap<string, string | null>) {
  if (tokens.length === 1) return tokens[0];
  const candidates = tokens.filter((candidate) => tokens.every((other) =>
    other === candidate || isStrictAncestor(other.mapId, candidate.mapId, parents)));
  return candidates.length === 1 ? candidates[0] : null;
}

export function buildTokenLocationNormalization(boardValue: unknown): TokenLocationNormalization {
  const board = isRecord(boardValue) ? boardValue : {};
  const groupSystems = new Map<string, string>();
  if (Array.isArray(board.groups)) {
    for (const candidate of board.groups) {
      if (!isRecord(candidate)) continue;
      const id = readString(candidate.id);
      const systemId = readString(candidate.systemId, "pyro");
      if (id) groupSystems.set(id, systemId);
    }
  }

  const source = isRecord(board.tokensBySystem)
    ? board.tokensBySystem
    : Array.isArray(board.tokens) ? { pyro: board.tokens } : {};
  const tokensBySystem = Object.fromEntries(Object.entries(source).map(([systemId, value]) => [
    systemId,
    Array.isArray(value) ? [...value] : [],
  ]));
  const locationsByGroup = new Map<string, LocatedToken[]>();
  for (const [systemId, values] of Object.entries(tokensBySystem)) {
    values.forEach((value, index) => {
      if (!isRecord(value)) return;
      const groupId = readString(value.groupId);
      if (!groupId) return;
      const location = { groupId, systemId, mapId: readString(value.mapId, "main"), index };
      locationsByGroup.set(groupId, [...(locationsByGroup.get(groupId) ?? []), location]);
    });
  }

  const removals: TokenLocationRemoval[] = [];
  const unresolved: UnresolvedTokenLocation[] = [];
  for (const [groupId, locations] of locationsByGroup) {
    const groupSystem = groupSystems.get(groupId);
    if (!groupSystem) {
      unresolved.push({ groupId, reason: "unknown-group" });
      continue;
    }
    const homeLocations = locations.filter((location) => location.systemId === groupSystem);
    if (homeLocations.length === 0) {
      unresolved.push({ groupId, reason: "no-group-owned-location" });
      continue;
    }
    const canonical = uniqueDeepest(homeLocations, mapParents(board, groupSystem));
    if (!canonical) {
      unresolved.push({ groupId, reason: "ambiguous-group-owned-locations" });
      continue;
    }
    for (const location of locations) {
      if (location === canonical) continue;
      removals.push({
        groupId,
        systemId: location.systemId,
        mapId: location.mapId,
        index: location.index,
        reason: location.systemId !== groupSystem ? "foreign-system" : "ancestor-shadow",
      });
    }
  }

  const removalKeys = new Set(removals.map((item) => `${item.systemId}:${item.index}`));
  const normalized = Object.fromEntries(Object.entries(tokensBySystem).map(([systemId, values]) => [
    systemId,
    values.filter((_, index) => !removalKeys.has(`${systemId}:${index}`)),
  ]));
  return { tokensBySystem: normalized, removals, unresolved };
}
