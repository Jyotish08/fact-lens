import { describe, expect, it, beforeEach } from "vitest";
import {
  checkSessionRateLimit,
  issueAnonymousToken,
  resetRateLimits,
  verifyAnonymousToken,
} from "./security.server";
import { ProviderError } from "./errors.server";

describe("Security & Abuse Cost Guard (T34)", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("issues and verifies valid anonymous session tokens", async () => {
    const sessionId = "test-session-123";
    const token = await issueAnonymousToken(sessionId);
    expect(typeof token).toBe("string");
    expect(token).toContain(".");

    const payload = await verifyAnonymousToken(token, sessionId);
    expect(payload.sid).toBe(sessionId);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it("rejects token when session ID does not match", async () => {
    const token = await issueAnonymousToken("session-A");
    await expect(verifyAnonymousToken(token, "session-B")).rejects.toThrow(ProviderError);
  });

  it("permits verifications within hourly limit", () => {
    const sessionId = "session-rate-ok";
    expect(() => {
      for (let i = 0; i < 5; i++) {
        checkSessionRateLimit(sessionId, 10);
      }
    }).not.toThrow();
  });

  it("throws RATE_LIMIT_EXCEEDED when session exceeds max verifications per hour", () => {
    const sessionId = "session-abuse";
    const maxLimit = 3;

    // Use up allowed budget
    checkSessionRateLimit(sessionId, maxLimit);
    checkSessionRateLimit(sessionId, maxLimit);
    checkSessionRateLimit(sessionId, maxLimit);

    // 4th request must throw 429 ProviderError
    expect(() => checkSessionRateLimit(sessionId, maxLimit)).toThrowError(
      /Session verification budget exceeded/i,
    );

    try {
      checkSessionRateLimit(sessionId, maxLimit);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const pe = err as ProviderError;
      expect(pe.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(pe.status).toBe(429);
      expect(pe.retryable).toBe(false);
    }
  });

  it("allows requests when maxClaimsPerHour is 0 (disabled)", () => {
    const sessionId = "session-unlimited";
    expect(() => {
      for (let i = 0; i < 20; i++) {
        checkSessionRateLimit(sessionId, 0);
      }
    }).not.toThrow();
  });
});
