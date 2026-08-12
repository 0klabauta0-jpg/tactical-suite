import { describe, expect, it } from "vitest";

import {
  parseAliveState,
  parseGroupRoles,
  parseSpawnState,
} from "@/lib/board/members";

describe("board member snapshot state", () => {
  it("keeps only alive and dead values", () => {
    expect(parseAliveState({ ada: "alive", bob: "dead", invalid: "missing", corrupted: 4 })).toEqual({
      ada: "alive",
      bob: "dead",
    });
  });

  it("keeps string spawn targets", () => {
    expect(parseSpawnState({ ada: "medbay", invalid: 42 })).toEqual({ ada: "medbay" });
  });

  it("keeps string group role assignments only", () => {
    expect(parseGroupRoles({
      alpha: { leader: "ada", deputy: "bob", ignored: true },
      broken: "not-an-object",
      beta: { leader: 42 },
    })).toEqual({ alpha: { leader: "ada", deputy: "bob" }, beta: {} });
  });
});
