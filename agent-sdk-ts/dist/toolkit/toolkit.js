import { Agent } from "../agent.js";
import { PermissionMode, permissionMiddleware } from "./permission.js";
import { calculator, dateTime } from "./tools.js";
/**
 * Toolkit is a registry of built-in agent tools. It keeps a stable ordering of
 * registered tools and applies a shared permission policy and middleware chain
 * to every tool it exposes.
 *
 * Tools fall into two groups:
 *   - Zero-config tools (calculator, dateTime) need no credentials, no network,
 *     and no host state. They are safe to inject automatically and make up the
 *     Default set.
 *   - Host-configured local fallback tools (file read/write, http fetch, sql)
 *     require the host to supply a sandbox root, an allowlist, or a database
 *     handle before they are safe. They are NOT part of Default; the host must
 *     configure and register them explicitly with an appropriate Permission.
 */
export class Toolkit {
    permission;
    middleware;
    byName = new Map();
    order = [];
    constructor(options = {}) {
        this.permission = options.permission ?? { mode: PermissionMode.Auto };
        this.middleware = options.middleware ? [...options.middleware] : [];
    }
    /**
     * register adds one or more tools to the toolkit. Later registrations with
     * the same name overwrite earlier ones while preserving first-seen ordering.
     */
    register(...tools) {
        for (const tool of tools) {
            if (!this.byName.has(tool.name)) {
                this.order.push(tool.name);
            }
            this.byName.set(tool.name, tool);
        }
        return this;
    }
    /**
     * tools returns the registered tools in stable order, each wrapped with the
     * toolkit's permission policy and middleware chain.
     */
    tools() {
        return this.order.map((name) => {
            const tool = this.byName.get(name);
            const wrapped = this.wrap(tool.name, normalizeExecute(tool));
            return { ...tool, execute: (input, context) => wrapped(input, context) };
        });
    }
    /**
     * wrap applies the permission check and middleware chain around a tool's
     * execute function. Middleware registered first is the outermost layer.
     */
    wrap(name, execute) {
        let handler = execute;
        handler = permissionMiddleware(name, this.permission)(name, handler);
        for (let i = this.middleware.length - 1; i >= 0; i--) {
            handler = this.middleware[i](name, handler);
        }
        return handler;
    }
}
/**
 * normalizeExecute adapts a tool's execute method (which may be sync or async)
 * into the Promise-returning ToolExecuteFunc the middleware chain expects.
 */
function normalizeExecute(tool) {
    return (input, context) => Promise.resolve(tool.execute(input, context));
}
/**
 * createToolkit creates an empty Toolkit with the given options.
 */
export function createToolkit(options) {
    return new Toolkit(options);
}
/**
 * defaultToolkit returns the safe default tool set: local, zero-cost compute
 * tools that require no credentials and no network access. It is the set
 * injected when a host application does not configure any tools of its own.
 *
 * Only zero-config tools belong here. The host-configured local fallback tools
 * are intentionally excluded: they need a sandbox root, an allowlist, or a
 * database handle, so the host must build and register them explicitly.
 */
export function defaultToolkit(options) {
    return new Toolkit(options).register(calculator(), dateTime());
}
/**
 * withDefaults implements convention-over-configuration for agent tools:
 * when the host application has not configured any tools (options.tools is
 * undefined), it injects the safe default tool set. An explicitly empty array
 * preserves the host's intent to run with no tools at all.
 *
 * It returns a copy of options with tools populated as needed, so it does not
 * mutate the caller's value. This keeps the transport/agent core free of any
 * dependency on toolkit, preserving the one-way dependency direction.
 *
 * Usage:
 *   const agent = new Agent(withDefaults({ model }));
 */
export function withDefaults(options, toolkitOptions) {
    if (options.tools === undefined) {
        return { ...options, tools: defaultToolkit(toolkitOptions).tools() };
    }
    return options;
}
/**
 * createAgent is a convenience constructor equivalent to
 * new Agent(withDefaults(options, toolkitOptions)).
 */
export function createAgent(options, toolkitOptions) {
    return new Agent(withDefaults(options, toolkitOptions));
}
//# sourceMappingURL=toolkit.js.map