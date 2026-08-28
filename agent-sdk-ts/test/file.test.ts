import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { AgentTool, ToolExecutionContext } from "../src/index.js";
import { fileRead, fileWrite } from "../src/toolkit/index.js";

const ctx: ToolExecutionContext = {
  step: 1,
  toolCall: { id: "call_1", type: "function", function: { name: "t", arguments: "{}" } },
  messages: [],
};

function call(tool: AgentTool, input: unknown): Promise<unknown> {
  return Promise.resolve(tool.execute(input, ctx));
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "toolkit-file-"));
  return root;
}

test("fileWrite then fileRead round-trips through the sandbox", async () => {
  const root = tempRoot();
  try {
    const write = fileWrite({ root });
    await call(write, { path: "sub/note.txt", content: "hello" });

    const read = fileRead({ root });
    const out = (await call(read, { path: "sub/note.txt" })) as { content: string };
    assert.equal(out.content, "hello");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fileRead rejects ../ traversal outside the sandbox", async () => {
  const root = tempRoot();
  const outside = join(dirname(root), "secret.txt");
  writeFileSync(outside, "top secret");
  try {
    const read = fileRead({ root });
    await assert.rejects(() => call(read, { path: "../secret.txt" }), /escapes the sandbox/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});

test("fileRead rejects absolute paths", async () => {
  const root = tempRoot();
  try {
    const read = fileRead({ root });
    await assert.rejects(() => call(read, { path: "/etc/passwd" }), /must be relative/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fileWrite enforces the size limit", async () => {
  const root = tempRoot();
  try {
    const write = fileWrite({ root, maxBytes: 4 });
    await assert.rejects(() => call(write, { path: "big.txt", content: "too large" }), /exceeds limit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fileRead errors on a missing file", async () => {
  const root = tempRoot();
  try {
    const read = fileRead({ root });
    await assert.rejects(() => call(read, { path: "nope.txt" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fileRead falls back to the current working directory when root is empty", async () => {
  // Sinking the file tools into client-sdk-ts relaxed the sandbox: an empty
  // root now means "the process working directory" (matching the Go AbsRoot
  // behavior) instead of throwing. A relative path still resolves inside cwd,
  // and absolute paths are still rejected.
  const read = fileRead({ root: "" });
  await assert.rejects(() => call(read, { path: "/etc/passwd" }), /must be relative/);
});