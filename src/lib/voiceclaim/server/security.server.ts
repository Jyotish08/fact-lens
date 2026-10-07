import "@tanstack/react-start/server-only";
import { getServerConfig } from "./config.server";
import { ProviderError } from "./errors.server";

interface TokenPayload {
  sid: string;
  iat: number;
  exp: number;
  nonce: string;
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw new ProviderError("voiceclaim", "INVALID_SESSION", "Invalid session token encoding");
  }
}

async function key() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getServerConfig().signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueAnonymousToken(sessionId: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sid: sessionId,
    iat: now,
    exp: now + 6 * 60 * 60,
    nonce: crypto.randomUUID(),
  };
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await key(), encoder.encode(body));
  return `${body}.${b64url(new Uint8Array(signature))}`;
}

export async function verifyAnonymousToken(token: string, expectedSessionId?: string) {
  if (!token || typeof token !== "string") {
    throw new ProviderError("voiceclaim", "INVALID_SESSION", "Missing session token");
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new ProviderError("voiceclaim", "INVALID_SESSION", "Invalid session token format");
  }
  const [body, signature] = parts;
  if (!body || !signature) {
    throw new ProviderError("voiceclaim", "INVALID_SESSION", "Invalid session token structure");
  }

  try {
    const sigBytes = decode(signature);
    const valid = await crypto.subtle.verify(
      "HMAC",
      await key(),
      sigBytes as unknown as BufferSource,
      encoder.encode(body),
    );
    if (!valid) {
      throw new ProviderError("voiceclaim", "INVALID_SESSION", "Session token signature mismatch");
    }

    const jsonText = new TextDecoder().decode(decode(body));
    const payload = JSON.parse(jsonText) as Partial<TokenPayload>;

    if (
      typeof payload.sid !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number"
    ) {
      throw new ProviderError("voiceclaim", "INVALID_SESSION", "Malformed session payload");
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new ProviderError("voiceclaim", "EXPIRED_SESSION", "Session token has expired");
    }

    if (expectedSessionId && payload.sid !== expectedSessionId) {
      throw new ProviderError(
        "voiceclaim",
        "SESSION_MISMATCH",
        "Session token does not match active session",
      );
    }

    return payload as TokenPayload;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("voiceclaim", "INVALID_SESSION", "Failed to verify session token");
  }
}

interface RateLimitBucket {
  count: number;
  resetAtMs: number;
}

const sessionRateLimits = new Map<string, RateLimitBucket>();

export function checkSessionRateLimit(sessionId: string, maxClaimsPerHour?: number) {
  const config = getServerConfig();
  const limit = maxClaimsPerHour ?? config.maxClaimsPerHour ?? 60;
  if (limit <= 0) return; // 0 or negative disables rate limit (e.g. for dev/tests)

  const now = Date.now();
  const bucket = sessionRateLimits.get(sessionId);

  if (!bucket || now >= bucket.resetAtMs) {
    sessionRateLimits.set(sessionId, {
      count: 1,
      resetAtMs: now + 3600_000,
    });
    return;
  }

  if (bucket.count >= limit) {
    throw new ProviderError(
      "voiceclaim",
      "RATE_LIMIT_EXCEEDED",
      `Session verification budget exceeded: maximum ${limit} claims per hour allowed`,
      false,
      429,
    );
  }

  bucket.count++;
}

export function resetRateLimits() {
  sessionRateLimits.clear();
}

