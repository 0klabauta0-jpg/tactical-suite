import { describe, expect, it } from "vitest";
import { parsePlayersCsv } from "@/lib/players/csv";

describe("parsePlayersCsv", () => {
  it("reads supported columns and normalizes the app role", () => {
    const result = parsePlayersCsv(
      "PlayerId,Spielername,Bereich,Rolle,Staffel,Status,Ampel,AppRolle,Heimatort\n" +
      "pilot-7,Ada Lovelace,Führung,Scout,4th Wing,ready,gut, COMMANDER ,Lorville\n",
    );

    expect(result.players).toEqual([
      {
        id: "pilot-7",
        name: "Ada Lovelace",
        area: "Führung",
        role: "Scout",
        squadron: "4th Wing",
        status: "ready",
        ampel: "gut",
        appRole: "commander",
        homeLocation: "Lorville",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("uses a deterministic ID when a player ID is absent", () => {
    const result = parsePlayersCsv("Spielername,AppRolle\nAda Lovelace,viewer\n");

    expect(result.players[0]?.id).toBe("p_1fmai4a");
  });

  it("skips nameless rows and reports the row", () => {
    const result = parsePlayersCsv("PlayerId,Spielername\nmissing-name,\nvalid,Grace Hopper\n");

    expect(result.players).toHaveLength(1);
    expect(result.warnings).toEqual([
      { code: "missing-name", row: 2, message: "Spielername fehlt" },
    ]);
  });

  it("turns unknown app roles into viewer", () => {
    const result = parsePlayersCsv("Spielername,AppRolle\nGrace Hopper,owner\n");

    expect(result.players[0]?.appRole).toBe("viewer");
  });

  it("uses the header row when Papa Parse cannot locate a CSV error", () => {
    const result = parsePlayersCsv("Spielername\n\"unterminated");

    expect(result.warnings).toEqual([
      { code: "csv-parse", row: 2, message: "Quoted field unterminated" },
      { code: "csv-parse", row: 1, message: "Unable to auto-detect delimiting character; defaulted to ','" },
    ]);
  });
});
