import { describe, expect, it } from "vitest";
import { sanitizeAndValidateModel, STANDARD_OPENAI_MODELS } from "./config.server";
import { handleOpenAIError } from "./openai.server";
import { ProviderError, publicError, sanitizeSecrets } from "./errors.server";
import { issueAnonymousToken, verifyAnonymousToken } from "./security.server";
import OpenAI from "openai";

describe("Model Validation Guardrails", () => {
  it("preserves official OpenAI GA models including GPT-5.6 Luna, Sol, and Terra", () => {
    expect(sanitizeAndValidateModel("gpt-5.6-luna", "fast")).toBe("gpt-5.6-luna");
    expect(sanitizeAndValidateModel("gpt-5.6-luna", "synthesis")).toBe("gpt-5.6-luna");
    expect(sanitizeAndValidateModel("gpt-5.6-sol", "synthesis")).toBe("gpt-5.6-sol");
    expect(sanitizeAndValidateModel("gpt-5.6-terra", "fast")).toBe("gpt-5.6-terra");
    expect(sanitizeAndValidateModel("gpt-4o-mini", "fast")).toBe("gpt-4o-mini");
    expect(sanitizeAndValidateModel("gpt-4o", "synthesis")).toBe("gpt-4o");
    expect(sanitizeAndValidateModel("text-embedding-3-small", "embedding")).toBe(
      "text-embedding-3-small",
    );
    expect(sanitizeAndValidateModel("text-embedding-3-large", "embedding")).toBe(
      "text-embedding-3-large",
    );
  });

  it("detects and falls back on incompatible non-OpenAI third-party models", () => {
    expect(sanitizeAndValidateModel("claude-3-5-sonnet", "fast")).toBe(STANDARD_OPENAI_MODELS.fast);
    expect(sanitizeAndValidateModel("gemini-1.5-pro", "synthesis")).toBe(STANDARD_OPENAI_MODELS.synthesis);
    expect(sanitizeAndValidateModel("deepseek-v3", "fast")).toBe(STANDARD_OPENAI_MODELS.fast);
  });

  it("warns but does not substitute unknown models (allowing live probe check)", () => {
    expect(sanitizeAndValidateModel("unknown-custom-model", "embedding")).toBe(
      "unknown-custom-model",
    );
    expect(sanitizeAndValidateModel("ft:gpt-4o-custom:my-org", "fast")).toBe(
      "ft:gpt-4o-custom:my-org",
    );
  });

  it("includes verifier role defaulting to gpt-4o-mini", () => {
    expect(STANDARD_OPENAI_MODELS.verifier).toBe("gpt-4o-mini");
    expect(sanitizeAndValidateModel(undefined, "verifier")).toBe("gpt-4o-mini");
  });
});

describe("Model Probe Availability", () => {
  it("reports availability status", async () => {
    const { probeModel, clearModelProbeCache } = await import("./openai.server");
    clearModelProbeCache();
    const result = await probeModel("nonexistent-model-xyz");
    expect(result).toHaveProperty("available");
    expect(typeof result.available).toBe("boolean");
  });
});

describe("OpenAI Error Classification and Diagnostics", () => {
  it("classifies 401 Unauthorized correctly", () => {
    const error = new OpenAI.APIError(401, { error: { message: "Incorrect API key provided: sk-proj-123456789012345" } }, "Incorrect API key", new Headers());
    const classified = handleOpenAIError(error);
    expect(classified.code).toBe("OPENAI_UNAUTHORIZED");
    expect(classified.retryable).toBe(false);
  });

  it("differentiates 429 Insufficient Quota from Rate Limits", () => {
    const quotaError = new OpenAI.APIError(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota." } }, "Quota error", new Headers());
    const classifiedQuota = handleOpenAIError(quotaError);
    expect(classifiedQuota.code).toBe("OPENAI_INSUFFICIENT_QUOTA");
    expect(classifiedQuota.retryable).toBe(false);

    const rateLimitError = new OpenAI.APIError(429, { error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, "Rate limit", new Headers());
    const classifiedRate = handleOpenAIError(rateLimitError);
    expect(classifiedRate.code).toBe("OPENAI_RATE_LIMIT_EXCEEDED");
    expect(classifiedRate.retryable).toBe(true);
  });

  it("classifies 404 Model Not Found and 400 Bad Request", () => {
    const notFoundError = new OpenAI.APIError(404, { error: { message: "The model `gpt-5.6-luna` does not exist" } }, "Model not found", new Headers());
    const classified404 = handleOpenAIError(notFoundError);
    expect(classified404.code).toBe("OPENAI_MODEL_NOT_FOUND");
    expect(classified404.retryable).toBe(false);

    const badRequestError = new OpenAI.APIError(400, { error: { message: "Invalid schema property" } }, "Bad request", new Headers());
    const classified400 = handleOpenAIError(badRequestError);
    expect(classified400.code).toBe("OPENAI_BAD_REQUEST");
  });

  it("classifies network timeouts and socket hangups", () => {
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "AbortError";
    const classifiedTimeout = handleOpenAIError(timeoutErr);
    expect(classifiedTimeout.code).toBe("OPENAI_NETWORK_TIMEOUT");
    expect(classifiedTimeout.retryable).toBe(true);

    const socketErr = new Error("socket hang up");
    const classifiedSocket = handleOpenAIError(socketErr);
    expect(classifiedSocket.code).toBe("OPENAI_NETWORK_ERROR");
  });
});

describe("Secret Redaction and Sanitization", () => {
  it("redacts API keys and Bearer tokens from error strings", () => {
    const raw = "Request failed for key sk-proj-abcdef1234567890abcdef with Bearer secret_token_value_xyz";
    const redacted = sanitizeSecrets(raw);
    expect(redacted).not.toContain("sk-proj-abcdef1234567890abcdef");
    expect(redacted).not.toContain("secret_token_value_xyz");
    expect(redacted).toContain("sk-***[REDACTED]***");
  });

  it("publicError redacts sensitive secrets", () => {
    const err = new ProviderError("openai", "OPENAI_UNAUTHORIZED", "Failed with key sk-proj-1234567890abcdef12345");
    expect(publicError(err)).not.toContain("sk-proj-1234567890abcdef12345");
  });
});

describe("Session HMAC Token Security", () => {
  it("issues and verifies a valid session token", async () => {
    const token = await issueAnonymousToken("session-alpha");
    const payload = await verifyAnonymousToken(token, "session-alpha");
    expect(payload.sid).toBe("session-alpha");
  });

  it("rejects token for mismatched sessionId or tampered token", async () => {
    const token = await issueAnonymousToken("session-alpha");
    try {
      await verifyAnonymousToken(token, "session-beta");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe("SESSION_MISMATCH");
    }

    const tampered = token.slice(0, -4) + "XXXX";
    try {
      await verifyAnonymousToken(tampered, "session-alpha");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe("INVALID_SESSION");
    }
  });
});
