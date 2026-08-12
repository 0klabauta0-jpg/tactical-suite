import type { Player } from "@/lib/domain/player";
import { parsePlayersCsv } from "@/lib/players/csv";

export type PlayerLoadResult = {
  players: Player[];
  source: "sheet" | "cache" | "none";
  warning?: string;
};

type SheetFetch = (url: string, init: RequestInit) => Promise<Response>;

function withSheetRange(sheetUrl: string): string {
  const withRange = sheetUrl.includes("range=")
    ? sheetUrl
    : `${sheetUrl}${sheetUrl.includes("?") ? "&" : "?"}range=A10:Z10000`;
  return `${withRange}${withRange.includes("?") ? "&" : "?"}_t=${Date.now()}`;
}

function cachedResult(players: Player[], warning: string): PlayerLoadResult {
  return { players, source: players.length > 0 ? "cache" : "none", warning };
}

export async function loadPlayersFromSheet(
  sheetUrl: string,
  cachedPlayers: Player[],
  fetchSheet: SheetFetch = (url, init) => fetch(url, init),
): Promise<PlayerLoadResult> {
  if (!sheetUrl.startsWith("http")) {
    return cachedResult(cachedPlayers, "Keine gültige Google-Sheet-CSV-URL für diesen Raum.");
  }

  try {
    const response = await fetchSheet(withSheetRange(sheetUrl), { cache: "no-store" });
    if (!response.ok) return cachedResult(cachedPlayers, `Google Sheet antwortet mit HTTP ${response.status}.`);

    const parsed = parsePlayersCsv(await response.text());
    const warning = parsed.warnings.length === 0
      ? undefined
      : `CSV enthält ${parsed.warnings.length} ungültige ${parsed.warnings.length === 1 ? "Zeile" : "Zeilen"}.`;
    return { players: parsed.players, source: "sheet", warning };
  } catch {
    return cachedResult(cachedPlayers, "Google Sheet konnte nicht geladen werden.");
  }
}
