export type BoardPlayerAliveState = Record<string, "alive" | "dead">;
export type BoardPlayerSpawnState = Record<string, string>;
export type BoardGroupRoles = Record<string, { leader?: string; deputy?: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAliveState(value: unknown): BoardPlayerAliveState {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, "alive" | "dead"] => entry[1] === "alive" || entry[1] === "dead"),
  );
}

export function parseSpawnState(value: unknown): BoardPlayerSpawnState {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function parseGroupRoles(value: unknown): BoardGroupRoles {
  if (!isRecord(value)) return {};
  const groups: BoardGroupRoles = {};
  for (const [groupId, assignment] of Object.entries(value)) {
    if (!isRecord(assignment)) continue;
    groups[groupId] = {
      ...(typeof assignment.leader === "string" ? { leader: assignment.leader } : {}),
      ...(typeof assignment.deputy === "string" ? { deputy: assignment.deputy } : {}),
    };
  }
  return groups;
}
