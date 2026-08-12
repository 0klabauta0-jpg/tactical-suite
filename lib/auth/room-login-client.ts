import type { RoomFeatures } from "@/lib/rooms/config";
import type { Role } from "@/lib/domain/roles";
import type { Player } from "@/lib/domain/player";

export type RoomLoginPlayer = {
  id: string;
  name: string;
  role: Role;
  profile: {
    area: string;
    role: string;
    squadron: string;
    status: string;
    ampel: string;
    homeLocation: string;
    icon?: string;
  };
};

type LoginResponse = {
  customToken: string;
  player: RoomLoginPlayer;
  room: { name: string; features: RoomFeatures };
  legacyAuth: boolean;
};

export function roomLoginPlayerToDomain(player: RoomLoginPlayer): Player {
  return {
    id: player.id,
    name: player.name,
    appRole: player.role,
    ...player.profile,
  };
}

type LoginInput = {
  roomId: string;
  handle: string;
  password: string;
  fetchLogin?: (url: string, init: RequestInit) => Promise<Response>;
  signIn: (customToken: string) => Promise<unknown>;
};

export async function loginToRoom(input: LoginInput): Promise<LoginResponse> {
  const fetchLogin = input.fetchLogin ?? fetch;
  const response = await fetchLogin(`/api/rooms/${encodeURIComponent(input.roomId)}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ handle: input.handle, password: input.password }),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Anmeldung momentan nicht möglich.");
  }
  if (!body || typeof body.customToken !== "string" || typeof body.player !== "object" || body.player === null
    || typeof body.room !== "object" || body.room === null) {
    throw new Error("Ungültige Serverantwort.");
  }
  await input.signIn(body.customToken);
  return body as unknown as LoginResponse;
}
