import {
  parseTokenLocation,
  type TokenLocation,
  type TokenTransferCommand,
  type TokenTransferResult,
} from "@/lib/map/token-transfer";

export class TokenTransferClientError extends Error {
  constructor(message: string, public readonly currentLocation?: TokenLocation) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseResult(value: unknown, command: TokenTransferCommand): TokenTransferResult | null {
  if (!isRecord(value) || value.operationId !== command.operationId || value.groupId !== command.groupId
    || value.systemId !== command.systemId) return null;
  const location = parseTokenLocation(value.location);
  return location ? {
    operationId: command.operationId,
    groupId: command.groupId,
    systemId: command.systemId,
    location,
  } : null;
}

export async function transferTokenClient(
  roomId: string,
  command: TokenTransferCommand,
  getIdToken: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenTransferResult> {
  const token = await getIdToken();
  const response = await fetchImpl(`/api/rooms/${encodeURIComponent(roomId)}/token-transfers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(command),
  });
  const body = await response.json().catch(() => null) as unknown;
  const record = isRecord(body) ? body : {};
  if (!response.ok) {
    const currentLocation = parseTokenLocation(record.currentLocation);
    throw new TokenTransferClientError(
      typeof record.error === "string" ? record.error : "Trupp konnte nicht verschoben werden.",
      currentLocation ?? undefined,
    );
  }
  const result = parseResult(record.result, command);
  if (!result) throw new TokenTransferClientError("Ungültige Antwort des Transferdienstes.");
  return result;
}
