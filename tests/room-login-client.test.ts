import { describe, expect, it } from "vitest";
import { loginToRoom } from "@/lib/auth/room-login-client";

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
          player: { id: "p1", name: "Ada", role: "viewer" },
          room: { name: "Alpha", features: { mobileStatus: false, rockbreaker3d: false } },
          legacyAuth: false,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      signIn: async (token) => { signedIn.push(token); },
    });
    expect(requests).toEqual([{ url: "/api/rooms/alpha/login", body: JSON.stringify({ handle: "Ada", password: "team-secret" }) }]);
    expect(signedIn).toEqual(["custom-token"]);
    expect(result.player).toEqual({ id: "p1", name: "Ada", role: "viewer" });
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
});
