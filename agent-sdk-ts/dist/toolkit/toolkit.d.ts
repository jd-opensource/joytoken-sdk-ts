import { Agent } from "../agent.js";
import type { AgentOptions, AgentTool } from "../types.js";
import type { Middleware } from "./middleware.js";
import { Permission } from "./permission.js";
/**
 * ToolkitOptions customizes a Toolkit at construction time.
 */
export interface ToolkitOptions {
    /** permission is the policy applied to every tool. Defaults to Auto. */
    permission?: Permission;
    /** middleware is applied to every tool, outermost first. */
    middleware?: Middleware[];
}
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
export declare class Toolkit {
    private readonly permission;
    private readonly middleware;
    private readonly byName;
    private readonly order;
    constructor(options?: ToolkitOptions);
    /**
     * register adds one or more tools to the toolkit. Later registrations with
     * the same name overwrite earlier ones while preserving first-seen ordering.
     */
    register(...tools: AgentTool[]): this;
    /**
     * tools returns the registered tools in stable order, each wrapped with the
     * toolkit's permission policy and middleware chain.
     */
    tools(): AgentTool[];
    /**
     * wrap applies the permission check and middleware chain around a tool's
     * execute function. Middleware registered first is the outermost layer.
     */
    private wrap;
}
/**
 * createToolkit creates an empty Toolkit with the given options.
 */
export declare function createToolkit(options?: ToolkitOptions): Toolkit;
/**
 * defaultToolkit returns the safe default tool set: local, zero-cost compute
 * tools that require no credentials and no network access. It is the set
 * injected when a host application does not configure any tools of its own.
 *
 * Only zero-config tools belong here. The host-configured local fallback tools
 * are intentionally excluded: they need a sandbox root, an allowlist, or a
 * database handle, so the host must build and register them explicitly.
 */
export declare function defaultToolkit(options?: ToolkitOptions): Toolkit;
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
export declare function withDefaults(options: AgentOptions, toolkitOptions?: ToolkitOptions): AgentOptions;
/**
 * createAgent is a convenience constructor equivalent to
 * new Agent(withDefaults(options, toolkitOptions)).
 */
export declare function createAgent(options: AgentOptions, toolkitOptions?: ToolkitOptions): Agent;
//# sourceMappingURL=toolkit.d.ts.map