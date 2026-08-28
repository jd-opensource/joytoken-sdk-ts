/**
 * PermissionMode controls whether a tool may run without host approval.
 */
export var PermissionMode;
(function (PermissionMode) {
    /**
     * Auto runs the tool without asking. Suitable for read-only,
     * zero-side-effect tools such as calculator or datetime.
     */
    PermissionMode["Auto"] = "auto";
    /**
     * Ask defers the decision to the host application through the
     * PermissionFunc callback. Suitable for side-effecting tools such as file
     * writes or SQL mutations.
     */
    PermissionMode["Ask"] = "ask";
    /**
     * Deny blocks the tool from running.
     */
    PermissionMode["Deny"] = "deny";
})(PermissionMode || (PermissionMode = {}));
/**
 * permissionMiddleware enforces the permission policy around a tool's execute.
 */
export function permissionMiddleware(name, permission) {
    return (_name, next) => {
        return async (input, execution) => {
            switch (permission.mode) {
                case PermissionMode.Deny:
                    throw new Error(`tool ${JSON.stringify(name)} denied by permission policy`);
                case PermissionMode.Ask: {
                    if (!permission.ask) {
                        throw new Error(`tool ${JSON.stringify(name)} requires approval but no permission handler is configured`);
                    }
                    let allow;
                    try {
                        allow = await permission.ask({
                            toolName: name,
                            input,
                            step: execution.step,
                        });
                    }
                    catch (error) {
                        throw new Error(`tool ${JSON.stringify(name)} permission check failed: ${error instanceof Error ? error.message : String(error)}`);
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
//# sourceMappingURL=permission.js.map