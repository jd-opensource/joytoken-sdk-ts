import type { ToolExecutionContext } from "../types.js";
import type { Middleware, ToolExecuteFunc } from "./middleware.js";

/**
 * PermissionMode controls whether a tool may run without host approval.
 */
export enum PermissionMode {
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
  Deny = "deny",
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
export function permissionMiddleware(name: string, permission: Permission): Middleware {
  return (_name: string, next: ToolExecuteFunc): ToolExecuteFunc => {
    return async (input: unknown, execution: ToolExecutionContext): Promise<unknown> => {
      switch (permission.mode) {
        case PermissionMode.Deny:
          throw new Error(`tool ${JSON.stringify(name)} denied by permission policy`);
        case PermissionMode.Ask: {
          if (!permission.ask) {
            throw new Error(
              `tool ${JSON.stringify(name)} requires approval but no permission handler is configured`,
            );
          }
          let allow: boolean;
          try {
            allow = await permission.ask({
              toolName: name,
              input,
              step: execution.step,
            });
          } catch (error) {
            throw new Error(
              `tool ${JSON.stringify(name)} permission check failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          if (!allow) {
            throw new Error(`tool ${JSON.stringify(name)} rejected by permission handler`);
          }
          break;
        }
        case PermissionMode.Auto:
          // no gate
          break;
      }
      return next(input, execution);
    };
  };
}