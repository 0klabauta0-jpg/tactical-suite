export type LoginRateLimitState = {
  attempts: number;
  windowStartedAtMs: number;
  blockedUntilMs: number;
};

export function parseLoginRateLimitState(value: unknown): LoginRateLimitState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Number.isInteger(record.attempts) || (record.attempts as number) < 0
    || typeof record.windowStartedAtMs !== "number" || !Number.isFinite(record.windowStartedAtMs)
    || typeof record.blockedUntilMs !== "number" || !Number.isFinite(record.blockedUntilMs)) return null;
  return {
    attempts: record.attempts as number,
    windowStartedAtMs: record.windowStartedAtMs,
    blockedUntilMs: record.blockedUntilMs,
  };
}

export function advanceLoginRateLimit(
  previous: LoginRateLimitState | null,
  nowMs: number,
  limits: { maxAttempts: number; windowMs: number; blockMs: number },
): { allowed: boolean; state: LoginRateLimitState } {
  if (previous && previous.blockedUntilMs > nowMs) return { allowed: false, state: previous };
  const current = !previous || nowMs - previous.windowStartedAtMs > limits.windowMs
    ? { attempts: 0, windowStartedAtMs: nowMs, blockedUntilMs: 0 }
    : previous;
  const attempts = current.attempts + 1;
  if (attempts > limits.maxAttempts) {
    return {
      allowed: false,
      state: { ...current, attempts, blockedUntilMs: nowMs + limits.blockMs },
    };
  }
  return { allowed: true, state: { ...current, attempts, blockedUntilMs: 0 } };
}
