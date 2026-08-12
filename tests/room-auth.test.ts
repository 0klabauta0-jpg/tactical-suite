import { describe, expect, it } from "vitest";
import { requireRoomMemberWith, type RoomAuthDependencies } from "@/lib/server/room-auth";

const request = new Request("https://app.test/api", { headers: { Authorization: "Bearer valid" } });

function dependencies(overrides: Partial<RoomAuthDependencies> = {}): RoomAuthDependencies {
  return {
    verifyIdToken: async () => ({ uid: "uid-1", roomId: "alpha", playerId: "p1", authVersion: 1 }),
    getMember: async () => ({ uid: "uid-1", playerId: "p1", name: "Ada", role: "viewer",
      authVersion: 1, verifiedAtMs: 1 }),
    refreshMember: async (member) => member,
    ...overrides,
  };
}

describe("requireRoomMember", () => {
  it("accepts a matching signed room and member identity", async () => {
    await expect(requireRoomMemberWith(dependencies(), request, "alpha"))
      .resolves.toMatchObject({ playerId: "p1", role: "viewer" });
  });

  it("rejects missing bearer tokens and cross-room claims", async () => {
    await expect(requireRoomMemberWith(dependencies(), new Request("https://app.test"), "alpha"))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(requireRoomMemberWith(dependencies({
      verifyIdToken: async () => ({ uid: "uid-1", roomId: "bravo", playerId: "p1", authVersion: 1 }),
    }), request, "alpha")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("enforces roles and refreshes them when requested", async () => {
    await expect(requireRoomMemberWith(dependencies(), request, "alpha", { roles: ["admin"] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireRoomMemberWith(dependencies({
      refreshMember: async (member) => ({ ...member, role: "commander" }),
    }), request, "alpha", { roles: ["commander"], freshRole: true }))
      .resolves.toMatchObject({ role: "commander" });
  });
});
