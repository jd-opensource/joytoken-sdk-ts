export function defineTool(tool) {
    return tool;
}
export function toChatTool(tool) {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters ?? { type: "object", properties: {} },
        },
    };
}
export function stringifyToolResult(value) {
    if (typeof value === "string")
        return value;
    return JSON.stringify(value) ?? "null";
}
//# sourceMappingURL=tools.js.map