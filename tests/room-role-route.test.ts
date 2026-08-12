import { describe, expect, it } from "vitest";
import { createRoomRoleHandlers } from "@/app/api/rooms/[roomId]/roles/[playerId]/route";

const context = { params: Promise.resolve({ roomId: "alpha", playerId: "p2" }) };

describe("room role route", () => {
  it("requires an admin and writes only a validated role", async () => {
    const writes: unknown[] = [];
    const handlers = createRoomRoleHandlers({
      requireAdmin: async () => ({ uid: "u1", playerId: "p1", name: "Ada", role: "admin", authVersion: 1, verifiedAtMs: 1 }),
      setRole: async (input) => { writes.push(input); },
    });
    const response = await handlers.PUT(new Request("https://app.test", {
      method: "PUT", body: JSON.stringify({ role: "commander", ignored: "x" }),
    }), context);
    expect(response.status).toBe(200);
    expect(writes).toEqual([{ roomId: "alpha", playerId: "p2", role: "commander", updatedBy: "u1" }]);
  });

  it("rejects unknown roles before writing", async () => {
    let wrote = false;
    const handlers = createRoomRoleHandlers({
      requireAdmin: async () => ({ uid: "u1", playerId: "p1", name: "Ada", role: "admin", authVersion: 1, verifiedAtMs: 1 }),
      setRole: async () => { wrote = true; },
    });
    const response = await handlers.PUT(new Request("https://app.test", {
      method: "PUT", body: JSON.stringify({ role: "owner" }),
    }), context);
    expect(response.status).toBe(400);
    expect(wrote).toBe(false);
  });
});
