import "@tanstack/react-start/server-only";
import { requireIntegration } from "./config.server";
import { canonicalizeUrl } from "./evidence";
import { ProviderError } from "./errors.server";
import { retry, withDeadline } from "./retry.server";
import { logProviderStage } from "./logging.server";
import { parseSearchHits } from "../bright-data-parser";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface RetrievedPage extends SearchHit {
  candidateId: string;
  domain: string;
  markdown: string;
  retrievedAt: string;
}

function resultText(result: { content?: Array<{ type: string; text?: string }> }) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpSession {
  id: string;
  lastUsedAt: number;
  tools: Set<string>;
}

// Reuse a remote MCP session for the short lifetime of a verification request.
// This prevents several simultaneous claims from opening a fresh connection for
// every single search, which otherwise overwhelms the remote handshake endpoint.
const sessions = new Map<string, Promise<McpSession>>();
const SESSION_TTL_MS = 4 * 60_000;

function classifyTransportFailure(error: unknown) {
  const details = [
    error instanceof Error ? error.message : "",
    error && typeof error === "object" && "cause" in error
      ? String((error as { cause?: unknown }).cause ?? "")
      : "",
  ].join(" ");
  if (/ENOTFOUND|EAI_AGAIN|No such host is known|DNS/i.test(details)) {
    return new ProviderError(
      "brightdata",
      "BRIGHTDATA_NETWORK_UNREACHABLE",
      "Bright Data could not be reached. Check DNS, firewall, or network access to mcp.brightdata.com.",
      true,
    );
  }
  if (/AbortError|REQUEST_TIMEOUT|timed out/i.test(details)) {
    return new ProviderError(
      "brightdata",
      "BRIGHTDATA_TIMEOUT",
      "Bright Data MCP did not respond before the request deadline",
      true,
    );
  }
  return new ProviderError(
    "brightdata",
    "BRIGHTDATA_MCP_ERROR",
    "Bright Data MCP request failed",
    true,
  );
}

async function mcpRequest(
  endpoint: URL,
  payload: Record<string, unknown>,
  timeoutMs: number,
  sessionId?: string,
  parentSignal?: AbortSignal,
) {
  return withDeadline(
    async (signal) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal,
      });
      if (!response.ok) {
        throw new ProviderError(
          "brightdata",
          `BRIGHTDATA_HTTP_${response.status}`,
          `Bright Data MCP request failed (${response.status})`,
          response.status === 408 || response.status === 429 || response.status >= 500,
          response.status,
        );
      }
    const body = await response.text();
    if (!body && payload["method"] === "notifications/initialized") {
      return { response: {} as JsonRpcResponse, sessionId: sessionId ?? "" };
    }
    const contentType = response.headers.get("content-type") ?? "";
    const message = contentType.includes("text/event-stream")
      ? parseSseJsonRpc(body)
      : (JSON.parse(body) as JsonRpcResponse);
    if (message.error) {
      throw new ProviderError(
        "brightdata",
        `BRIGHTDATA_RPC_${message.error.code}`,
        message.error.message,
        message.error.code === -32603,
      );
    }
    return {
      response: message,
      sessionId: response.headers.get("mcp-session-id") ?? sessionId ?? "",
    };
  }, timeoutMs);
}

function parseSseJsonRpc(body: string): JsonRpcResponse {
  const messages = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  const last = messages.at(-1);
  if (!last)
    throw new ProviderError(
      "brightdata",
      "BRIGHTDATA_EMPTY_STREAM",
      "Bright Data MCP stream was empty",
      true,
    );
  return JSON.parse(last) as JsonRpcResponse;
}

async function openSession(endpoint: URL) {
  const key = endpoint.toString();
  const existing = sessions.get(key);
  if (existing) {
    const session = await existing;
    if (Date.now() - session.lastUsedAt < SESSION_TTL_MS) return session;
    sessions.delete(key);
  }

  const opening = (async (): Promise<McpSession> => {
    const initialized = await mcpRequest(
      endpoint,
      {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "voiceclaim-auditor", version: "1.0.0" },
        },
      },
      35_000,
    );
    if (!initialized.sessionId) {
      throw new ProviderError(
        "brightdata",
        "BRIGHTDATA_SESSION_MISSING",
        "Bright Data did not return an MCP session identifier",
        true,
      );
    }
    await mcpRequest(
      endpoint,
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      10_000,
      initialized.sessionId,
    );
    const listed = await mcpRequest(
      endpoint,
      {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/list",
        params: {},
      },
      15_000,
      initialized.sessionId,
    );
    const tools = new Set(
      ((listed.response.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [])
        .map((tool) => tool.name)
        .filter((name): name is string => Boolean(name)),
    );
    return { id: initialized.sessionId, lastUsedAt: Date.now(), tools };
  })();
  sessions.set(key, opening);
  try {
    return await opening;
  } catch (error) {
    sessions.delete(key);
    throw error;
  }
}

async function callTool(
  name: "search_engine" | "scrape_as_markdown",
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const started = Date.now();
  const config = requireIntegration("brightdata");
  if (!config.brightDataToken) {
    throw new ProviderError(
      "brightdata",
      "BRIGHTDATA_NOT_CONFIGURED",
      "Bright Data is not configured",
    );
  }
  const endpoint = new URL(config.brightDataMcpUrl);
  endpoint.searchParams.set("token", config.brightDataToken);
  try {
    const session = await openSession(endpoint);
    if (!session.tools.has(name)) {
      throw new ProviderError(
        "brightdata",
        "BRIGHTDATA_TOOL_UNAVAILABLE",
        `Bright Data MCP does not expose the required ${name} tool`,
        false,
      );
    }
    const called = await mcpRequest(
      endpoint,
      {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      },
      name === "search_engine" ? 45_000 : 60_000,
      session.id,
      signal,
    );
    session.lastUsedAt = Date.now();
    const result = called.response.result as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    if (result.isError)
      throw new ProviderError("brightdata", "BRIGHTDATA_TOOL_ERROR", `${name} failed`, true);
    const text = resultText(result);
    if (!text)
      throw new ProviderError(
        "brightdata",
        "BRIGHTDATA_EMPTY_RESULT",
        `${name} returned no content`,
        true,
      );
    logProviderStage({
      provider: "brightdata",
      stage: name,
      durationMs: Date.now() - started,
      count: 1,
    });
    return text;
  } catch (error) {
    sessions.delete(endpoint.toString());
    const classified = error instanceof ProviderError ? error : classifyTransportFailure(error);
    logProviderStage({
      provider: "brightdata",
      stage: name,
      durationMs: Date.now() - started,
      errorCode: classified.code,
    });
    throw classified;
  }
}

export async function searchWeb(query: string, signal?: AbortSignal) {
  const { getCachedSerp, setCachedSerp } = await import("./v2/cache.server");
  const cached = getCachedSerp(query);
  if (cached) {
    logProviderStage({
      provider: "brightdata",
      stage: "search_engine_cache_hit",
      durationMs: 0,
      count: cached.length,
    });
    return cached;
  }

  const { withFixture } = await import("./fixtures.server");
  const hits = await withFixture("search", query, async () => {
    const text = await retry(() => callTool("search_engine", { query, engine: "google" }, signal));
    return parseSearchHits(text);
  });
  setCachedSerp(query, hits);
  return hits;
}

export async function scrapePage(
  hit: SearchHit,
  candidateId: string,
  signal?: AbortSignal,
): Promise<RetrievedPage> {
  const url = canonicalizeUrl(hit.url);
  const parsed = new URL(url);
  const domain = parsed.hostname.replace(/^www\./, "");

  const { getCachedScrape, setCachedScrape } = await import("./v2/cache.server");
  const cachedMarkdown = getCachedScrape(url);
  if (cachedMarkdown !== undefined) {
    logProviderStage({
      provider: "brightdata",
      stage: "scrape_cache_hit",
      durationMs: 0,
      count: 1,
    });
    return {
      ...hit,
      url,
      candidateId,
      domain,
      markdown: cachedMarkdown,
      retrievedAt: new Date().toISOString(),
    };
  }

  const { withFixture } = await import("./fixtures.server");
  const markdown = await withFixture("scrape", url, async () => {
    return retry(() => callTool("scrape_as_markdown", { url }, signal));
  });
  const rawMarkdown = typeof markdown === "string" ? markdown : (markdown as { markdown?: string })?.markdown ?? "";
  const slicedMarkdown = rawMarkdown.slice(0, 80_000);
  setCachedScrape(url, slicedMarkdown);

  return {
    ...hit,
    url,
    candidateId,
    domain,
    markdown: slicedMarkdown,
    retrievedAt: new Date().toISOString(),
  };
}

