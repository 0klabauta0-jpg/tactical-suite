import type { RoomFeatures } from "@/lib/rooms/config";
import type { Role } from "@/lib/domain/roles";

type LoginResponse = {
  customToken: string;
  player: { id: string; name: string; role: Role };
  room: { name: string; features: RoomFeatures };
  legacyAuth: boolean;
};

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
