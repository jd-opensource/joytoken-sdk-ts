import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  fileRead,
  fileSearch,
  fileWrite,
  gateFileWrite,
  listDir,
  type FileSandbox,
  type FilePermissionFunc,
  type ToolExecutionContext,
} from "../src/index.js";

// ctx builds a minimal ToolExecutionContext so we can drive a tool's execute
// directly, without standing up the full client loop.
function ctx(step = 0): ToolExecutionContext {
  return {
    step,
    toolCall: { id: "call_0", type: "function", function: { name: "", arguments: "" } },
    messages: [],
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// A symlink inside the sandbox that points outside it must not become an escape
// hatch: lexical containment passes, but the real path is outside the root.
test("resolvePath rejects reads/writes through a symlink that escapes the root", async (t) => {
  if (platform() === "win32") {
    t.skip("symlink creation is unreliable on Windows CI");
    return;
  }
  const base = await mkdtemp(join(tmpdir(), "jt-sandbox-"));
  t.after(() => rm(base, { recursive: true, force: true }));

  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "secret.txt"), "top secret", "utf8");

  // link -> ../outside, planted inside the sandbox root.
  await symlink(outside, join(root, "link"), "dir");

  const sandbox: FileSandbox = { root };

  await assert.rejects(
    () => fileRead(sandbox).execute!({ path: "link/secret.txt" }, ctx()),
    /escapes the sandbox root via a symlink/,
  );

  await assert.rejects(
    () => listDir(sandbox).execute!({ path: "link" }, ctx()),
    /escapes the sandbox root via a symlink/,
  );

  // A write whose parent is the escaping symlink must be refused, and nothing
  // may land on disk outside the sandbox.
  await assert.rejects(
    () => fileWrite(sandbox).execute!({ path: "link/planted.txt", content: "x" }, ctx()),
    /escapes the sandbox root via a symlink/,
  );
  assert.equal(await pathExists(join(outside, "planted.txt")), false);

  const search = (await fileSearch(sandbox).execute!({ pattern: "*.txt" }, ctx())) as { matches: string[] };
  assert.deepEqual(search.matches, [], "file_search must not recurse into an escaping symlink directory");
});

test("resolvePath allows legitimate paths inside the root", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "jt-sandbox-ok-"));
  t.after(() => rm(base, { recursive: true, force: true }));

  const sandbox: FileSandbox = { root: base };
  await fileWrite(sandbox).execute!({ path: "sub/note.txt", content: "hello" }, ctx());
  const read = (await fileRead(sandbox).execute!({ path: "sub/note.txt" }, ctx())) as { content: string };
  assert.equal(read.content, "hello");
});

// gateFileWrite must fail safe: a denied or throwing permission callback blocks
// the write entirely and leaves the disk untouched.
test("gateFileWrite blocks the write and leaves disk untouched when denied", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "jt-gate-"));
  t.after(() => rm(base, { recursive: true, force: true }));

  const sandbox: FileSandbox = { root: base };
  const deny: FilePermissionFunc = () => false;
  const gated = gateFileWrite(fileWrite(sandbox), base, deny);

  await assert.rejects(
    () => gated.execute!({ path: "out.txt", content: "should not land" }, ctx()),
    /rejected by file permission handler/,
  );
  assert.equal(await pathExists(join(base, "out.txt")), false);
});

test("gateFileWrite surfaces a throwing permission callback and leaves disk untouched", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "jt-gate-throw-"));
  t.after(() => rm(base, { recursive: true, force: true }));

  const sandbox: FileSandbox = { root: base };
  const boom: FilePermissionFunc = () => {
    throw new Error("handler exploded");
  };
  const gated = gateFileWrite(fileWrite(sandbox), base, boom);

  await assert.rejects(
    () => gated.execute!({ path: "out.txt", content: "x" }, ctx()),
    /permission check failed: handler exploded/,
  );
  assert.equal(await pathExists(join(base, "out.txt")), false);
});

test("gateFileWrite lets an approved write reach disk", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "jt-gate-ok-"));
  t.after(() => rm(base, { recursive: true, force: true }));

  const sandbox: FileSandbox = { root: base };
  const allow: FilePermissionFunc = () => true;
  const gated = gateFileWrite(fileWrite(sandbox), base, allow);

  await gated.execute!({ path: "out.txt", content: "landed" }, ctx());
  const read = (await fileRead(sandbox).execute!({ path: "out.txt" }, ctx())) as { content: string };
  assert.equal(read.content, "landed");
});
