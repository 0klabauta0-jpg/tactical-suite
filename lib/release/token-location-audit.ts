import { groupTokenObjectId, parseSceneObject, type SceneObject } from "@/lib/rockbreaker/scene-objects";
import { parseRockbreakerSceneConfig } from "@/lib/rockbreaker/scene-config";

export type TokenLocationAuditIssueCode =
  | "INVALID_TOKEN"
  | "UNKNOWN_GROUP"
  | "DUPLICATE_2D_LOCATION"
  | "CROSS_RENDERER_DUPLICATE"
  | "INVALID_SCENE_OBJECT"
  | "ENTRY_CONFIG_MISSING"
  | "ENTRY_CONFIG_INVALID";

export type TokenLocationAuditIssue = {
  code: TokenLocationAuditIssueCode;
  documentPath: string;
  fieldPath?: string;
  groupId?: string;
  message: string;
  blocking: true;
};

export type TokenLocationAuditInput = {
  roomId: string;
  boardDocument: unknown;
  sceneMetadata: unknown;
  sceneDocuments: ReadonlyArray<{ path: string; data: unknown }>;
};

type ValidToken = { groupId: string; systemId: string; fieldPath: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseAuditToken(value: unknown): { groupId: string } | null {
  if (!isRecord(value) || typeof value.groupId !== "string" || !value.groupId.trim()) return null;
  if (typeof value.x !== "number" || !Number.isFinite(value.x) || value.x < 0 || value.x > 1) return null;
  if (typeof value.y !== "number" || !Number.isFinite(value.y) || value.y < 0 || value.y > 1) return null;
  if (value.mapId !== undefined && (typeof value.mapId !== "string" || !value.mapId.trim())) return null;
  return { groupId: value.groupId };
}

function issue(
  code: TokenLocationAuditIssueCode,
  documentPath: string,
  message: string,
  details: Pick<TokenLocationAuditIssue, "fieldPath" | "groupId"> = {},
): TokenLocationAuditIssue {
  return { code, documentPath, message, blocking: true, ...details };
}

export function auditTokenLocations(input: TokenLocationAuditInput): TokenLocationAuditIssue[] {
  const boardPath = `rooms/${input.roomId}/state/board`;
  const scenePath = `rooms/${input.roomId}/mapScenes/nyx--rockbreaker`;
  const issues: TokenLocationAuditIssue[] = [];
  const board = isRecord(input.boardDocument) ? input.boardDocument : {};
  const groups = new Map<string, string>();
  if (Array.isArray(board.groups)) {
    for (const candidate of board.groups) {
      if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.trim()) continue;
      groups.set(candidate.id, typeof candidate.systemId === "string" && candidate.systemId ? candidate.systemId : "pyro");
    }
  }

  const validTokens: ValidToken[] = [];
  const scanTokens = (systemId: string, value: unknown, fieldPath: string) => {
    if (!Array.isArray(value)) {
      issues.push(issue("INVALID_TOKEN", boardPath, "Tokenliste ist kein Array.", { fieldPath }));
      return;
    }
    value.forEach((candidate, index) => {
      const itemPath = `${fieldPath}[${index}]`;
      const token = parseAuditToken(candidate);
      if (!token) {
        issues.push(issue("INVALID_TOKEN", boardPath, "Token besitzt keine gültige Gruppe oder 2D-Koordinate.", { fieldPath: itemPath }));
        return;
      }
      validTokens.push({ groupId: token.groupId, systemId, fieldPath: itemPath });
      if (!groups.has(token.groupId) || groups.get(token.groupId) !== systemId) {
        issues.push(issue("UNKNOWN_GROUP", boardPath, "Token verweist auf keine Gruppe dieses Systems.", {
          fieldPath: itemPath,
          groupId: token.groupId,
        }));
      }
    });
  };

  if (isRecord(board.tokensBySystem)) {
    for (const [systemId, value] of Object.entries(board.tokensBySystem)) {
      scanTokens(systemId, value, `tokensBySystem.${systemId}`);
    }
  } else if (board.tokens !== undefined) {
    scanTokens("pyro", board.tokens, "tokens");
  }

  const tokensByGroup = new Map<string, ValidToken[]>();
  for (const token of validTokens) {
    tokensByGroup.set(token.groupId, [...(tokensByGroup.get(token.groupId) ?? []), token]);
  }
  for (const [groupId, locations] of tokensByGroup) {
    if (locations.length > 1) {
      issues.push(issue("DUPLICATE_2D_LOCATION", boardPath, "Gruppe besitzt mehrere gespeicherte 2D-Positionen.", {
        fieldPath: locations.map((location) => location.fieldPath).join(","),
        groupId,
      }));
    }
  }

  const validSceneGroups: SceneObject[] = [];
  for (const document of input.sceneDocuments) {
    const parsed = parseSceneObject(document.data);
    const documentId = document.path.split("/").at(-1) ?? "";
    if (!parsed || parsed.id !== documentId
      || (parsed.type === "groupToken" && parsed.id !== groupTokenObjectId(parsed.groupId))) {
      issues.push(issue("INVALID_SCENE_OBJECT", document.path, "3D-Szenenobjekt ist ungültig oder besitzt keine kanonische ID."));
      continue;
    }
    if (parsed.type !== "groupToken") continue;
    validSceneGroups.push(parsed);
    if (!groups.has(parsed.groupId) || groups.get(parsed.groupId) !== "nyx") {
      issues.push(issue("UNKNOWN_GROUP", document.path, "3D-Truppenmarker verweist auf keine Nyx-Gruppe.", { groupId: parsed.groupId }));
    }
  }

  for (const object of validSceneGroups) {
    if (tokensByGroup.has(object.type === "groupToken" ? object.groupId : "")) {
      issues.push(issue("CROSS_RENDERER_DUPLICATE", `${scenePath}/objects/${object.id}`, "Gruppe besitzt gleichzeitig eine 2D- und 3D-Position.", {
        groupId: object.type === "groupToken" ? object.groupId : undefined,
      }));
    }
  }

  if (!parseRockbreakerSceneConfig(input.sceneMetadata)) {
    const hasEntry = isRecord(input.sceneMetadata) && Object.hasOwn(input.sceneMetadata, "troopEntry");
    issues.push(issue(
      hasEntry ? "ENTRY_CONFIG_INVALID" : "ENTRY_CONFIG_MISSING",
      scenePath,
      hasEntry ? "Rockbreaker-Einstiegskoordinaten sind ungültig." : "Rockbreaker-Einstiegskoordinaten fehlen.",
      { fieldPath: "troopEntry" },
    ));
  }

  return issues;
}
