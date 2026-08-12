import { describe, expect, it } from "vitest";
import { advanceLoginRateLimit } from "@/lib/server/login-rate-limit-state";

describe("login rate limit", () => {
  it("blocks the eleventh attempt in one window", () => {
    let state = null;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const result = advanceLoginRateLimit(state, 1_000 + attempt, {
        maxAttempts: 10,
        windowMs: 10_000,
        blockMs: 20_000,
      });
      expect(result.allowed).toBe(true);
      state = result.state;
    }

    const blocked = advanceLoginRateLimit(state, 2_000, {
      maxAttempts: 10,
      windowMs: 10_000,
      blockMs: 20_000,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.state.blockedUntilMs).toBe(22_000);
  });

  it("starts a fresh counter after the window", () => {
    const previous = { attempts: 10, windowStartedAtMs: 1_000, blockedUntilMs: 0 };
    const result = advanceLoginRateLimit(previous, 11_001, {
      maxAttempts: 10,
      windowMs: 10_000,
      blockMs: 20_000,
    });
    expect(result).toEqual({
      allowed: true,
      state: { attempts: 1, windowStartedAtMs: 11_001, blockedUntilMs: 0 },
    });
  });
});
