import "@tanstack/react-start/server-only";
import { ProviderError } from "./errors.server";

export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("REQUEST_TIMEOUT")), timeoutMs);
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}

export async function retry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
) {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 350;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      last = error;
      if (!(error instanceof ProviderError) || !error.retryable || attempt === attempts)
        throw error;
      const jitter = Math.floor(Math.random() * 200);
      const delay = error.retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30_000)));
    }
  }
  throw last;
}
