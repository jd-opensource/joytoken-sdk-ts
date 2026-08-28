import type { AgentTool } from "../types.js";
import { defineTool } from "../tools.js";
import { stringArg } from "./tools.js";

/**
 * HTTPFetchConfig configures the local HTTP fetch fallback tool. This tool is a
 * local safety net for gateways that do not passthrough web fetching; when the
 * gateway forwards web fetching to the vendor (e.g. the Responses API
 * web_search built-in tool), prefer that instead.
 *
 * allowedHosts is an allowlist of hostnames the model may fetch. It is
 * mandatory: an empty allowlist denies every request, which prevents SSRF by
 * default. timeoutMs and maxBytes have safe defaults.
 */
export interface HTTPFetchConfig {
  /** allowedHosts lists hostnames (exact match, case-insensitive). Empty means deny all. */
  allowedHosts: string[];
  /** timeoutMs bounds a single request. Zero/undefined means DefaultHTTPTimeoutMs. */
  timeoutMs?: number;
  /** maxBytes caps the response body read into memory. Zero/undefined means DefaultHTTPMaxBytes. */
  maxBytes?: number;
  /** fetchImpl overrides the global fetch, mainly for testing. */
  fetchImpl?: typeof fetch;
}

/** Defaults for the HTTP fetch tool. */
export const DefaultHTTPTimeoutMs = 15_000;
export const DefaultHTTPMaxBytes = 1 << 20; // 1 MiB

/**
 * httpFetch returns a local, read-only HTTP GET tool constrained to an explicit
 * host allowlist. It is side-effect free but reaches the network, so register
 * it under PermissionAuto only when the allowlist is trusted; otherwise use
 * PermissionAsk.
 */
export function httpFetch(config: HTTPFetchConfig): AgentTool {
  const allowed = new Set(
    (config.allowedHosts ?? []).map((host) => host.trim().toLowerCase()).filter(Boolean),
  );
  const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DefaultHTTPTimeoutMs;
  const maxBytes = config.maxBytes && config.maxBytes > 0 ? config.maxBytes : DefaultHTTPMaxBytes;
  const doFetch = config.fetchImpl ?? fetch;

  return defineTool({
    name: "http_fetch",
    description:
      "Fetch the text body of an HTTP(S) URL via GET. Only hosts on the configured allowlist are permitted.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http:// or https:// URL to fetch.",
        },
      },
      required: ["url"],
    },
    execute: async (input) => {
      const raw = stringArg(input, "url");
      const parsed = validateURL(raw, allowed);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await doFetch(parsed.toString(), {
          method: "GET",
          signal: controller.signal,
          redirect: "follow",
        });
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`http_fetch: request timed out after ${timeoutMs}ms`);
        }
        throw new Error(`http_fetch: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        const buffer = await readLimited(response, maxBytes);
        return {
          status: response.status,
          content_type: response.headers.get("content-type") ?? "",
          body: buffer.text,
          bytes: buffer.bytes,
          truncated: buffer.truncated,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

/** readLimited reads at most maxBytes from the response body. */
async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    return { text: buffer.subarray(0, maxBytes).toString("utf8"), bytes: maxBytes, truncated: true };
  }
  return { text: buffer.toString("utf8"), bytes: buffer.byteLength, truncated: false };
}

/**
 * validateURL parses the URL, enforces the http(s) scheme, and checks the host
 * against the allowlist. An empty allowlist denies everything.
 */
function validateURL(raw: string, allowed: Set<string>): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch (error) {
    throw new Error(`http_fetch: invalid URL: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`http_fetch: only http and https URLs are allowed, got ${JSON.stringify(parsed.protocol)}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new Error("http_fetch: URL has no host");
  }
  if (allowed.size === 0) {
    throw new Error(`http_fetch: host ${JSON.stringify(host)} is not allowed (allowlist is empty)`);
  }
  if (!allowed.has(host)) {
    throw new Error(`http_fetch: host ${JSON.stringify(host)} is not on the allowlist`);
  }
  return parsed;
}