import { parseRole } from "@/lib/domain/roles";
import type { Player, PlayerOverrides } from "@/lib/domain/player";

export function mergeWithOverrides(players: Player[], overrides: PlayerOverrides): Player[] {
  return players.map((player) => {
    const override = overrides[player.id];
    if (!override) return player;

    const { lastSheetAppRole, ...fields } = override;
    const sheetRole = parseRole(player.appRole);
    const overrideRole = override.appRole === undefined ? undefined : parseRole(override.appRole);
    const resolvedAppRole = lastSheetAppRole !== undefined && sheetRole !== parseRole(lastSheetAppRole)
      ? sheetRole
      : (overrideRole ?? sheetRole);

    return { ...player, ...fields, id: player.id, appRole: resolvedAppRole };
  });
}
