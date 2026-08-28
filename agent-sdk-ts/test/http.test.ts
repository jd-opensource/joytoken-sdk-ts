import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTool, ToolExecutionContext } from "../src/index.js";
import { httpFetch } from "../src/toolkit/index.js";

const ctx: ToolExecutionContext = {
  step: 1,
  toolCall: { id: "call_1", type: "function", function: { name: "t", arguments: "{}" } },
  messages: [],
};

function call(tool: AgentTool, input: unknown): Promise<unknown> {
  return Promise.resolve(tool.execute(input, ctx));
}

/** fakeFetch returns a fixed body so tests never touch the real network. */
function fakeFetch(body: string, contentType = "text/plain"): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": contentType },
    })) as unknown as typeof fetch;
}

test("httpFetch returns the body for an allowlisted host", async () => {
  const tool = httpFetch({ allowedHosts: ["example.com"], fetchImpl: fakeFetch("pong") });
  const out = (await call(tool, { url: "https://example.com/ping" })) as {
    body: string;
    status: number;
  };
  assert.equal(out.body, "pong");
  assert.equal(out.status, 200);
});

test("httpFetch rejects a host that is not on the allowlist", async () => {
  const tool = httpFetch({ allowedHosts: ["example.com"], fetchImpl: fakeFetch("pong") });
  await assert.rejects(
    () => call(tool, { url: "https://evil.test/x" }),
    /not on the allowlist/,
  );
});

test("httpFetch denies everything when the allowlist is empty (SSRF guard)", async () => {
  const tool = httpFetch({ allowedHosts: [], fetchImpl: fakeFetch("pong") });
  await assert.rejects(
    () => call(tool, { url: "https://example.com/x" }),
    /allowlist is empty/,
  );
});

test("httpFetch rejects non-http(s) schemes", async () => {
  const tool = httpFetch({ allowedHosts: ["localhost"], fetchImpl: fakeFetch("pong") });
  await assert.rejects(
    () => call(tool, { url: "file:///etc/passwd" }),
    /only http and https/,
  );
});

test("httpFetch truncates a body larger than maxBytes", async () => {
  const tool = httpFetch({
    allowedHosts: ["example.com"],
    maxBytes: 4,
    fetchImpl: fakeFetch("abcdefghij"),
  });
  const out = (await call(tool, { url: "https://example.com/big" })) as {
    bytes: number;
    truncated: boolean;
  };
  assert.equal(out.bytes, 4);
  assert.equal(out.truncated, true);
});

test("httpFetch surfaces a timeout as an error", async () => {
  const slowFetch = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })) as unknown as typeof fetch;
  const tool = httpFetch({ allowedHosts: ["example.com"], timeoutMs: 10, fetchImpl: slowFetch });
  await assert.rejects(() => call(tool, { url: "https://example.com/slow" }), /timed out/);
});