import { describe, expect, it } from "vitest";
import * as roomLoginClient from "@/lib/auth/room-login-client";

const { loginToRoom } = roomLoginClient;

describe("room login client", () => {
  it("exchanges handle and password for a custom token without persisting the password", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const signedIn: string[] = [];
    const result = await loginToRoom({
      roomId: "alpha",
      handle: "Ada",
      password: "team-secret",
      fetchLogin: async (url, init) => {
        requests.push({ url, body: String(init.body) });
        return new Response(JSON.stringify({
          customToken: "custom-token",
          player: { id: "p1", name: "Ada", role: "viewer", profile: {
            area: "", role: "", squadron: "", status: "", ampel: "", homeLocation: "",
          } },
          room: { name: "Alpha", features: { mobileStatus: false, rockbreaker3d: false } },
          legacyAuth: false,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      signIn: async (token) => { signedIn.push(token); },
    });
    expect(requests).toEqual([{ url: "/api/rooms/alpha/login", body: JSON.stringify({ handle: "Ada", password: "team-secret" }) }]);
    expect(signedIn).toEqual(["custom-token"]);
    expect(result.player).toEqual({ id: "p1", name: "Ada", role: "viewer", profile: {
      area: "", role: "", squadron: "", status: "", ampel: "", homeLocation: "",
    } });
  });

  it("surfaces the server error and never signs in on rejection", async () => {
    let signedIn = false;
    await expect(loginToRoom({
      roomId: "alpha", handle: "Ada", password: "bad",
      fetchLogin: async () => new Response(JSON.stringify({ error: "Anmeldung fehlgeschlagen." }), {
        status: 401, headers: { "Content-Type": "application/json" },
      }),
      signIn: async () => { signedIn = true; },
    })).rejects.toThrow("Anmeldung fehlgeschlagen.");
    expect(signedIn).toBe(false);
  });

  it("restores the authenticated player's existing profile", () => {
    const toPlayer = (roomLoginClient as typeof roomLoginClient & {
      roomLoginPlayerToDomain?: (player: {
        id: string; name: string; role: "admin" | "commander" | "viewer";
        profile: { area: string; role: string; squadron: string; status: string; ampel: string; homeLocation: string; icon?: string };
      }) => unknown;
    }).roomLoginPlayerToDomain;
    expect(typeof toPlayer).toBe("function");
    if (!toPlayer) return;

    expect(toPlayer({
      id: "p1", name: "Ada", role: "commander",
      profile: { area: "Air", role: "Flight", squadron: "CER", status: "ready", ampel: "green", homeLocation: "Checkmate", icon: "pilot" },
    })).toEqual({
      id: "p1", name: "Ada", appRole: "commander", area: "Air", role: "Flight",
      squadron: "CER", status: "ready", ampel: "green", homeLocation: "Checkmate", icon: "pilot",
    });
  });
});
