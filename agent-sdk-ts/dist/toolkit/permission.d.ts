import type { Middleware } from "./middleware.js";
/**
 * PermissionMode controls whether a tool may run without host approval.
 */
export declare enum PermissionMode {
    /**
     * Auto runs the tool without asking. Suitable for read-only,
     * zero-side-effect tools such as calculator or datetime.
     */
    Auto = "auto",
    /**
     * Ask defers the decision to the host application through the
     * PermissionFunc callback. Suitable for side-effecting tools such as file
     * writes or SQL mutations.
     */
    Ask = "ask",
    /**
     * Deny blocks the tool from running.
     */
    Deny = "deny"
}
/**
 * PermissionRequest describes a pending tool invocation presented to the host
 * application for approval. The SDK never renders UI; the host decides.
 */
export interface PermissionRequest {
    toolName: string;
    input: unknown;
    step: number;
}
/**
 * PermissionFunc lets the host application approve or reject a tool call. It is
 * only consulted in Ask mode. Returning false blocks execution.
 */
export type PermissionFunc = (request: PermissionRequest) => Promise<boolean> | boolean;
/**
 * Permission is the policy applied to a tool before it executes.
 */
export interface Permission {
    mode: PermissionMode;
    /**
     * ask is invoked when mode is Ask. If undefined in Ask mode, the call is
     * denied to fail safe.
     */
    ask?: PermissionFunc;
}
/**
 * permissionMiddleware enforces the permission policy around a tool's execute.
 */
export declare function permissionMiddleware(name: string, permission: Permission): Middleware;
//# sourceMappingURL=permission.d.ts.map