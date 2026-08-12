import { describe, expect, it } from "vitest";
import { createRoomLoginHandler } from "@/app/api/rooms/[roomId]/login/route";
import { RoomLoginError } from "@/lib/server/room-login";

const context = { params: Promise.resolve({ roomId: "alpha" }) };

describe("room login route", () => {
  it("returns a no-store login response", async () => {
    let reset = false;
    const handler = createRoomLoginHandler({
      authenticate: async () => ({ customToken: "token", player: { id: "p1", name: "Ada", role: "viewer" as const,
        profile: { area: "", role: "", squadron: "", status: "", ampel: "", homeLocation: "" } },
        room: { name: "Alpha", features: { mobileStatus: false, rockbreaker3d: false } }, legacyAuth: false }),
      consumeAttempt: async () => true,
      resetAttempts: async () => { reset = true; },
      now: () => 100,
    });
    const response = await handler(new Request("https://app.test", {
      method: "POST", body: JSON.stringify({ handle: "Ada", password: "secret" }),
    }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ customToken: "token", player: { id: "p1" } });
    expect(reset).toBe(true);
  });

  it("rejects invalid bodies and maps generic login failures", async () => {
    let calls = 0;
    const handler = createRoomLoginHandler({
      authenticate: async () => { calls += 1; throw new RoomLoginError("INVALID_LOGIN"); },
      consumeAttempt: async () => true,
      resetAttempts: async () => undefined,
      now: () => 100,
    });
    const invalid = await handler(new Request("https://app.test", { method: "POST", body: "{}" }), context);
    expect(invalid.status).toBe(400);
    expect(calls).toBe(0);

    const rejected = await handler(new Request("https://app.test", {
      method: "POST", body: JSON.stringify({ handle: "Ada", password: "wrong" }),
    }), context);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ error: "Anmeldung fehlgeschlagen." });
  });

  it("returns 429 before authentication when the login budget is exhausted", async () => {
    let calls = 0;
    const handler = createRoomLoginHandler({
      authenticate: async () => { calls += 1; throw new Error("must not run"); },
      consumeAttempt: async () => false,
      resetAttempts: async () => undefined,
      now: () => 100,
    });
    const response = await handler(new Request("https://app.test", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.8" },
      body: JSON.stringify({ handle: "Ada", password: "wrong" }),
    }), context);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(calls).toBe(0);
  });
});
