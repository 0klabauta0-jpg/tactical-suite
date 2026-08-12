import { describe, expect, it } from "vitest";

import type { Player } from "@/lib/domain/player";
import { loadPlayersFromSheet } from "@/lib/players/sheet-loader";

const cachedPlayers: Player[] = [
  { id: "ada", name: "Ada Lovelace", appRole: "viewer" },
];

describe("loadPlayersFromSheet", () => {
  it("keeps cached players and reports an HTTP failure", async () => {
    const result = await loadPlayersFromSheet(
      "https://example.test/players.csv",
      cachedPlayers,
      async () => new Response("unavailable", { status: 503 }),
    );

    expect(result).toEqual({
      players: cachedPlayers,
      source: "cache",
      warning: "Google Sheet antwortet mit HTTP 503.",
    });
  });

  it("reports a network failure when no cache exists", async () => {
    const result = await loadPlayersFromSheet(
      "https://example.test/players.csv",
      [],
      async () => { throw new Error("offline"); },
    );

    expect(result).toEqual({
      players: [],
      source: "none",
      warning: "Google Sheet konnte nicht geladen werden.",
    });
  });

  it("returns fresh players while surfacing malformed CSV rows", async () => {
    const result = await loadPlayersFromSheet(
      "https://example.test/players.csv",
      cachedPlayers,
      async () => new Response('PlayerId,Spielername,AppRolle\nada,Ada,admin\n, ,viewer'),
    );

    expect(result).toEqual({
      players: [{ id: "ada", name: "Ada", appRole: "admin", area: "", role: "", squadron: "", status: "", ampel: "", homeLocation: "" }],
      source: "sheet",
      warning: "CSV enthält 1 ungültige Zeile.",
    });
  });
});
