/**
 * gateFileWrite wraps a file_write tool's execute with a host approval gate. It
 * fails safe: with no permission callback configured, or when the callback
 * rejects or throws, the write never happens and the model receives an error it
 * can react to. root is captured so the host sees the exact directory the write
 * targets.
 */
export function gateFileWrite(tool, root, permission) {
    const inner = tool.execute;
    if (!inner) {
        return tool;
    }
    const guarded = async (input, execution) => {
        if (!permission) {
            throw new Error(`tool ${JSON.stringify(tool.name)} rejected: no file permission handler configured (set filePermission to enable)`);
        }
        let allow;
        try {
            allow = await permission({
                toolName: tool.name,
                input,
                root,
                step: execution.step,
            });
        }
        catch (error) {
            throw new Error(`tool ${JSON.stringify(tool.name)} permission check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!allow) {
            throw new Error(`tool ${JSON.stringify(tool.name)} rejected by file permission handler`);
        }
        return inner(input, execution);
    };
    return { ...tool, execute: guarded };
}
//# sourceMappingURL=file-permission.js.map