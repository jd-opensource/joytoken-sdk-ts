import type { AgentTool } from "../types.js";
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
export declare const DefaultHTTPTimeoutMs = 15000;
export declare const DefaultHTTPMaxBytes: number;
/**
 * httpFetch returns a local, read-only HTTP GET tool constrained to an explicit
 * host allowlist. It is side-effect free but reaches the network, so register
 * it under PermissionAuto only when the allowlist is trusted; otherwise use
 * PermissionAsk.
 */
export declare function httpFetch(config: HTTPFetchConfig): AgentTool;
//# sourceMappingURL=http.d.ts.map