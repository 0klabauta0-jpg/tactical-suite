import Papa from "papaparse";
import { parseRole } from "@/lib/domain/roles";
import type { Player } from "@/lib/domain/player";

export type PlayerImportWarning = {
  code: "csv-parse" | "missing-name";
  row: number;
  message: string;
};

export type PlayerCsvParseResult = {
  players: Player[];
  warnings: PlayerImportWarning[];
};

type CsvRow = Record<string, string | undefined>;

export function stablePlayerId(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return `p_${(hash >>> 0).toString(36)}`;
}

export function parsePlayersCsv(text: string): PlayerCsvParseResult {
  const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true });
  const warnings: PlayerImportWarning[] = parsed.errors.map((error) => ({
    code: "csv-parse",
    row: (error.row ?? 0) + 1,
    message: error.message,
  }));
  const players: Player[] = [];

  parsed.data.forEach((row, index) => {
    const name = (row.Spielername ?? row.Name ?? "").trim();
    if (!name) {
      warnings.push({ code: "missing-name", row: index + 2, message: "Spielername fehlt" });
      return;
    }

    const explicitId = row.PlayerId?.trim();
    players.push({
      id: explicitId || stablePlayerId(name),
      name,
      area: row.Bereich ?? "",
      role: row.Rolle ?? "",
      squadron: row.Staffel ?? "",
      status: row.Status ?? "",
      ampel: row.Ampel ?? "",
      appRole: parseRole(row.AppRolle),
      homeLocation: row.Heimatort ?? "",
    });
  });

  return { players, warnings };
}
