import { DefaultFileMaxBytes as ClientDefaultFileMaxBytes, DefaultSearchLimit as ClientDefaultSearchLimit, fileRead as clientFileRead, fileWrite as clientFileWrite, listDir as clientListDir, fileSearch as clientFileSearch, } from "@joytoken/client-sdk-ts";
/** DefaultFileMaxBytes is the per-operation size cap used when maxBytes is unset. */
export const DefaultFileMaxBytes = ClientDefaultFileMaxBytes;
/** DefaultSearchLimit bounds how many entries list_dir and file_search return. */
export const DefaultSearchLimit = ClientDefaultSearchLimit;
/**
 * requireExecutable narrows a client Tool to an AgentTool, throwing if the tool
 * has no `execute`. This turns the AgentTool contract's only extra requirement
 * into a checked runtime invariant.
 */
function requireExecutable(tool) {
    if (typeof tool.execute !== "function") {
        throw new Error(`file tool ${JSON.stringify(tool.name)} is missing an execute function`);
    }
    return tool;
}
/** fileRead returns a local, read-only tool that reads a UTF-8 text file. */
export function fileRead(sandbox) {
    return requireExecutable(clientFileRead(sandbox));
}
/** fileWrite returns a local tool that writes a UTF-8 text file. */
export function fileWrite(sandbox) {
    return requireExecutable(clientFileWrite(sandbox));
}
/** listDir returns a local, read-only tool that lists a directory's entries. */
export function listDir(sandbox) {
    return requireExecutable(clientListDir(sandbox));
}
/** fileSearch returns a local, read-only tool that globs the sandbox for files. */
export function fileSearch(sandbox) {
    return requireExecutable(clientFileSearch(sandbox));
}
//# sourceMappingURL=file.js.map