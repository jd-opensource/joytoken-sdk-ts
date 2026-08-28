import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { defineTool, MaxArgBytes } from "./tools.js";
/** DefaultFileMaxBytes is the per-operation size cap used when maxBytes is unset. */
export const DefaultFileMaxBytes = 1 << 20; // 1 MiB
/** DefaultSearchLimit bounds how many entries list_dir and file_search return in one call. */
export const DefaultSearchLimit = 200;
/**
 * fileRead returns a local, read-only tool that reads a UTF-8 text file from
 * within the sandbox. It is side-effect free and safe to run without approval.
 */
export function fileRead(sandbox) {
    return defineTool({
        name: "file_read",
        description: "Read a UTF-8 text file located inside the configured directory. The path must be relative to that directory.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: 'File path relative to the sandbox root, e.g. "notes/todo.txt".',
                },
            },
            required: ["path"],
        },
        execute: async (input) => {
            const rel = stringArg(input, "path");
            const abs = await resolvePath(sandbox, rel);
            let info;
            try {
                info = await stat(abs);
            }
            catch (error) {
                throw new Error(`file_read: ${message(error)}`);
            }
            if (info.isDirectory()) {
                throw new Error(`file_read: ${JSON.stringify(rel)} is a directory`);
            }
            const max = maxBytes(sandbox);
            if (info.size > max) {
                throw new Error(`file_read: file is ${info.size} bytes, exceeds limit of ${max}`);
            }
            let data;
            try {
                data = await readFile(abs);
            }
            catch (error) {
                throw new Error(`file_read: ${message(error)}`);
            }
            return { path: rel, content: data.toString("utf8"), bytes: data.byteLength };
        },
    });
}
/**
 * fileWrite returns a local tool that writes a UTF-8 text file inside the
 * sandbox, creating parent directories as needed. Because it has real side
 * effects, the root client wraps its execute with a fail-closed host approval
 * gate. It may be declared without a callback, but cannot execute without one.
 */
export function fileWrite(sandbox) {
    return defineTool({
        name: "file_write",
        description: "Write a UTF-8 text file inside the configured directory, creating parent folders as needed. The path must be relative to that directory.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: 'File path relative to the sandbox root, e.g. "out/report.md".',
                },
                content: {
                    type: "string",
                    description: "The full UTF-8 text content to write. Existing files are overwritten.",
                },
            },
            required: ["path", "content"],
        },
        execute: async (input) => {
            const rel = stringArg(input, "path");
            const content = stringArg(input, "content");
            const max = maxBytes(sandbox);
            const size = Buffer.byteLength(content, "utf8");
            if (size > max) {
                throw new Error(`file_write: content is ${size} bytes, exceeds limit of ${max}`);
            }
            const abs = await resolvePath(sandbox, rel);
            try {
                await mkdir(dirname(abs), { recursive: true });
                await writeFile(abs, content, "utf8");
            }
            catch (error) {
                throw new Error(`file_write: ${message(error)}`);
            }
            return { path: rel, bytes: size };
        },
    });
}
/**
 * listDir returns a local, read-only tool that lists the entries of a directory
 * inside the sandbox. Use "." for the sandbox root. At most DefaultSearchLimit
 * entries are returned, with a truncated flag set when the directory has more,
 * so a huge directory cannot flood the model's context.
 */
export function listDir(sandbox) {
    return defineTool({
        name: "list_dir",
        description: 'List the entries of a directory inside the configured directory. Use "." for the root. The path must be relative.',
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: 'Directory path relative to the sandbox root. Use "." for the root.',
                },
            },
        },
        execute: async (input) => {
            const rel = optionalStringArg(input, "path") || ".";
            const abs = await resolvePath(sandbox, rel);
            let dirents;
            try {
                dirents = await readdir(abs, { withFileTypes: true });
            }
            catch (error) {
                throw new Error(`list_dir: ${message(error)}`);
            }
            const truncated = dirents.length > DefaultSearchLimit;
            const limited = truncated ? dirents.slice(0, DefaultSearchLimit) : dirents;
            const entries = await Promise.all(limited.map(async (dirent) => {
                const isDir = dirent.isDirectory();
                let bytes = 0;
                if (!isDir) {
                    try {
                        bytes = dirent.isSymbolicLink() ? 0 : (await lstat(join(abs, dirent.name))).size;
                    }
                    catch {
                        bytes = 0;
                    }
                }
                return { name: dirent.name, dir: isDir, bytes };
            }));
            return { path: rel, entries, truncated };
        },
    });
}
/**
 * fileSearch returns a local, read-only tool that recursively searches the
 * sandbox for files whose base name matches a glob pattern. Results are sorted
 * and capped at DefaultSearchLimit.
 */
export function fileSearch(sandbox) {
    return defineTool({
        name: "file_search",
        description: "Recursively search the configured directory for files whose name matches a glob pattern, e.g. \"*.md\".",
        parameters: {
            type: "object",
            properties: {
                pattern: {
                    type: "string",
                    description: 'Glob pattern matched against each file base name, e.g. "*.ts" or "README*".',
                },
            },
            required: ["pattern"],
        },
        execute: async (input) => {
            const pattern = stringArg(input, "pattern");
            const root = absRoot(sandbox);
            const matcher = globToRegExp(pattern);
            const matches = [];
            let truncated = false;
            const walk = async (dir) => {
                if (truncated)
                    return;
                let dirents;
                try {
                    dirents = await readdir(dir, { withFileTypes: true });
                }
                catch {
                    return;
                }
                for (const dirent of dirents) {
                    if (truncated)
                        return;
                    const full = join(dir, dirent.name);
                    if (dirent.isDirectory()) {
                        await walk(full);
                    }
                    else if (matcher.test(dirent.name)) {
                        matches.push(relative(root, full));
                        if (matches.length >= DefaultSearchLimit) {
                            truncated = true;
                            return;
                        }
                    }
                }
            };
            await walk(root);
            matches.sort();
            return { pattern, matches, count: matches.length, truncated };
        },
    });
}
/**
 * absRoot resolves the sandbox root to an absolute path. An empty root falls
 * back to the current working directory, so the exposed surface is the project
 * the host is actually running in. Exposed so the client can show the host the
 * exact directory a write would land in during permission prompts.
 */
export function absRoot(sandbox) {
    const root = sandbox.root && sandbox.root !== "" ? sandbox.root : (globalThis.process?.cwd?.() ?? ".");
    return resolve(root);
}
/**
 * resolvePath turns a model-supplied relative path into an absolute path and
 * guarantees it stays within the sandbox root, defeating "../" traversal,
 * absolute-path escapes, and symlink escapes. Lexical containment alone is not
 * enough: a symlink inside the sandbox can point outside it, so we resolve the
 * real (symlink-free) path of both the root and the deepest existing ancestor
 * of the target before comparing. The target itself may not exist yet (e.g. a
 * fresh file_write), so we only evaluate symlinks up to the closest existing
 * parent and treat the not-yet-created leaf segments lexically.
 */
async function resolvePath(sandbox, rel) {
    if (isAbsolute(rel)) {
        throw new Error(`path must be relative, got absolute path ${JSON.stringify(rel)}`);
    }
    const root = absRoot(sandbox);
    const abs = resolve(join(root, rel));
    // Reject on the lexical form first (cheap, catches the common cases).
    if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(`path ${JSON.stringify(rel)} escapes the sandbox root`);
    }
    let realRoot;
    try {
        realRoot = await realpath(root);
    }
    catch (error) {
        throw new Error(`cannot resolve sandbox root: ${message(error)}`);
    }
    // Then verify the real path of the deepest existing ancestor is still
    // contained, so an intermediate symlink cannot hop outside realRoot.
    const real = await evalDeepestExisting(abs);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
        throw new Error(`path ${JSON.stringify(rel)} escapes the sandbox root via a symlink`);
    }
    return abs;
}
/**
 * evalDeepestExisting resolves symlinks on the longest existing prefix of abs
 * and re-appends the remaining (not-yet-created) segments lexically. This lets
 * resolvePath validate write targets that do not exist yet without being fooled
 * by a symlinked parent directory.
 */
async function evalDeepestExisting(abs) {
    let remaining = "";
    let current = abs;
    for (;;) {
        try {
            const resolved = await realpath(current);
            return remaining === "" ? resolved : join(resolved, remaining);
        }
        catch (error) {
            if (!isNotFound(error)) {
                throw new Error(`cannot resolve path: ${message(error)}`);
            }
        }
        const parent = dirname(current);
        if (parent === current) {
            // Reached the filesystem root without finding an existing prefix.
            return abs;
        }
        remaining = remaining === "" ? basename(current) : join(basename(current), remaining);
        current = parent;
    }
}
function isNotFound(error) {
    return typeof error === "object" && error !== null && error.code === "ENOENT";
}
function maxBytes(sandbox) {
    return sandbox.maxBytes && sandbox.maxBytes > 0 ? sandbox.maxBytes : DefaultFileMaxBytes;
}
/** globToRegExp converts a simple glob (supporting * and ?) into an anchored RegExp. */
function globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
}
function stringArg(input, key) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw new Error(`expected object input, got ${describe(input)}`);
    }
    const object = input;
    if (!(key in object)) {
        throw new Error(`missing required argument ${JSON.stringify(key)}`);
    }
    const raw = object[key];
    const value = typeof raw === "string" ? raw : String(raw);
    if (value.length > MaxArgBytes) {
        throw new Error(`argument ${JSON.stringify(key)} is ${value.length} bytes, exceeds limit of ${MaxArgBytes}`);
    }
    return value;
}
function optionalStringArg(input, key) {
    if (typeof input !== "object" || input === null || Array.isArray(input))
        return "";
    const raw = input[key];
    return typeof raw === "string" ? raw : "";
}
function describe(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value;
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=file-tools.js.map