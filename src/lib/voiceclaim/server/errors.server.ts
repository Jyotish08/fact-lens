import "@tanstack/react-start/server-only";

export type ProviderName = "speechmatics" | "brightdata" | "openai" | "voiceclaim";

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(sanitizeSecrets(message));
    this.name = "ProviderError";
  }
}

export function sanitizeSecrets(text: string): string {
  if (!text) return "";
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***[REDACTED]***")
    .replace(/(?:Bearer\s+)[A-Za-z0-9_.-]{10,}/gi, "Bearer ***[REDACTED]***")
    .replace(/token=[A-Za-z0-9_.-]{10,}/gi, "token=***[REDACTED]***");
}

export function classifyProviderResponse(provider: ProviderName, response: Response) {
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMs = retryAfter
    ? Number.isFinite(Number(retryAfter))
      ? Number(retryAfter) * 1_000
      : Math.max(0, Date.parse(retryAfter) - Date.now())
    : undefined;
  return new ProviderError(
    provider,
    `${provider.toUpperCase()}_HTTP_${response.status}`,
    `${provider} request failed (${response.status})`,
    retryable,
    response.status,
    retryAfterMs,
  );
}

export function publicError(error: unknown) {
  if (error instanceof ProviderError) {
    if (error.code === "RETRIEVAL_UNAVAILABLE") {
      return "RETRIEVAL_UNAVAILABLE: Search providers unavailable — not a judgement on the claim.";
    }
    if (error.code === "RATE_LIMIT_EXCEEDED") {
      return "RATE_LIMIT_EXCEEDED: Session verification budget exceeded — please wait before submitting more claims.";
    }
    return sanitizeSecrets(`${error.code}: ${error.message}`);
  }
  if (typeof error === "string" && error.includes("RETRIEVAL_UNAVAILABLE")) {
    return "RETRIEVAL_UNAVAILABLE: Search providers unavailable — not a judgement on the claim.";
  }
  if (error instanceof Error) {
    if (/RETRIEVAL_UNAVAILABLE/i.test(error.message)) {
      return "RETRIEVAL_UNAVAILABLE: Search providers unavailable — not a judgement on the claim.";
    }
    if (/NOT_CONFIGURED/.test(error.message)) {
      return sanitizeSecrets(error.message);
    }
  }
  return "VERIFICATION_ERROR: The verification pipeline could not complete.";
}
