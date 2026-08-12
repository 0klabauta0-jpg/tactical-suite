import { describe, expect, it } from "vitest";
import { createRoomSetupHandler } from "@/app/api/rooms/[roomId]/setup/route";

const context = { params: Promise.resolve({ roomId: "alpha" }) };

describe("room setup route", () => {
  it("creates a room through the server without returning its password", async () => {
    const inputs: unknown[] = [];
    const handler = createRoomSetupHandler({
      setup: async (input) => { inputs.push(input); return { roomName: "Alpha", adminPlayerId: "p1" }; },
      now: () => 100,
    });
    const response = await handler(new Request("https://app.test", { method: "POST", body: JSON.stringify({
      setupSecret: "setup-secret", sheetUrl: "https://sheet.test", password: "team-secret",
      roomName: "Alpha", sheetShareUrl: "", adminHandle: "Ada",
    }) }), context);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ roomName: "Alpha", adminPlayerId: "p1" });
    expect(JSON.stringify(body)).not.toContain("team-secret");
    expect(inputs).toHaveLength(1);
  });

  it("rejects incomplete setup input before calling the service", async () => {
    let called = false;
    const handler = createRoomSetupHandler({ setup: async () => { called = true; throw new Error(); }, now: () => 1 });
    const response = await handler(new Request("https://app.test", { method: "POST", body: "{}" }), context);
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });
});
