/**
 * gateShell wraps a shell tool's execute with a host approval gate. It fails
 * safe: with no permission callback configured, or when the callback rejects or
 * throws, the command never runs and the model receives an error it can react
 * to. Because a shell command can do anything the host process can, the gate is
 * the safety boundary — the tool is always declared, but only runs behind it.
 * workingDir is captured so the host sees the exact directory a command targets.
 */
export function gateShell(tool, workingDir, permission) {
    const inner = tool.execute;
    if (!inner) {
        return tool;
    }
    const guarded = async (input, execution) => {
        if (!permission) {
            throw new Error(`tool ${JSON.stringify(tool.name)} rejected: no shell permission handler configured (set shellPermission to enable)`);
        }
        const command = commandArg(input);
        let allow;
        try {
            allow = await permission({
                toolName: tool.name,
                input,
                command,
                workingDir,
                step: execution.step,
            });
        }
        catch (error) {
            throw new Error(`tool ${JSON.stringify(tool.name)} permission check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!allow) {
            throw new Error(`tool ${JSON.stringify(tool.name)} rejected by shell permission handler`);
        }
        return inner(input, execution);
    };
    return { ...tool, execute: guarded };
}
/** commandArg extracts the model-supplied command string for the permission prompt, tolerating malformed input. */
function commandArg(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input))
        return "";
    const raw = input.command;
    return typeof raw === "string" ? raw : "";
}
//# sourceMappingURL=shell-permission.js.map