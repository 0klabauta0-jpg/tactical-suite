import type { Role } from "@/lib/domain/roles";

export type Player = {
  id: string;
  name: string;
  area?: string;
  role?: string;
  squadron?: string;
  status?: string;
  ampel?: string;
  appRole: Role;
  homeLocation?: string;
  icon?: string;
};

export type PlayerOverride = Partial<Omit<Player, "id">> & {
  lastSheetAppRole?: Role;
};

export type PlayerOverrides = Record<string, PlayerOverride>;

export type EditablePlayerField = Exclude<keyof Player, "id" | "appRole">;
