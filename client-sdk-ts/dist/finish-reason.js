/**
 * FinishReasonKind is the SDK's provider-neutral classification of a model
 * turn's finish_reason. Different gateways and model vendors spell their
 * terminal states differently (OpenAI: "stop"/"tool_calls"/"length";
 * Gemini: "STOP"/"MALFORMED_FUNCTION_CALL"/"MAX_TOKENS"; Anthropic:
 * "end_turn"/"tool_use"/"max_tokens"). The tool loop should never branch on
 * those raw strings directly; it normalizes them into this small enum so the
 * loop's control flow stays vendor-agnostic and new providers only need a new
 * mapping entry here.
 */
export var FinishReasonKind;
(function (FinishReasonKind) {
    /** Unrecognized or empty finish_reason. Treated as a normal stop. */
    FinishReasonKind["Unknown"] = "unknown";
    /** Clean end of turn: the model produced its final answer. */
    FinishReasonKind["Stop"] = "stop";
    /** The model asked to call one or more tools. */
    FinishReasonKind["ToolCalls"] = "tool_calls";
    /** The turn was cut off by a token/length limit. */
    FinishReasonKind["Length"] = "length";
    /** The turn was blocked by a safety filter. */
    FinishReasonKind["ContentFilter"] = "content_filter";
    /**
     * The model attempted a tool call but emitted an unparseable/invalid payload
     * that the gateway rejected (the Gemini-family "malformed_function_call"
     * case): the response carries no usable tool_calls even though the model was
     * trying to call one. It is transient and worth retrying with a corrective
     * nudge.
     */
    FinishReasonKind["MalformedToolCall"] = "malformed_function_call";
})(FinishReasonKind || (FinishReasonKind = {}));
/**
 * classifyFinishReason maps a raw provider finish_reason string to a
 * provider-neutral FinishReasonKind. Matching is case-insensitive and tolerant
 * of the separator differences seen across vendors (snake_case vs SCREAMING,
 * "toolCalls" etc.), so one entry covers each family. Unknown strings fall
 * through to Unknown, which the loop treats as a benign stop.
 */
export function classifyFinishReason(raw) {
    const norm = (raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/-/g, "_")
        .replace(/ /g, "_");
    switch (norm) {
        case "":
            return FinishReasonKind.Unknown;
        case "stop":
        case "end_turn":
        case "endturn":
        case "complete":
        case "completed":
            return FinishReasonKind.Stop;
        case "tool_calls":
        case "toolcalls":
        case "tool_use":
        case "tooluse":
        case "function_call":
        case "functioncall":
            return FinishReasonKind.ToolCalls;
        case "length":
        case "max_tokens":
        case "maxtokens":
        case "model_length":
            return FinishReasonKind.Length;
        case "content_filter":
        case "contentfilter":
        case "safety":
        case "blocklist":
        case "prohibited_content":
        case "recitation":
            return FinishReasonKind.ContentFilter;
        case "malformed_function_call":
        case "malformedfunctioncall":
        case "malformed_tool_call":
            return FinishReasonKind.MalformedToolCall;
        default:
            return FinishReasonKind.Unknown;
    }
}
/**
 * malformedToolCallNudge is appended to the transcript as a user turn when a
 * step comes back malformed. It steers the model to retry the tool call with a
 * strictly valid, minimal JSON payload — the most common fix for the
 * Gemini-family malformed_function_call, whose usual cause is invalid JSON in
 * string arguments (unescaped operators, unbalanced braces).
 */
export const malformedToolCallNudge = "Your previous tool call could not be parsed. " +
    "Retry the tool call with a strictly valid JSON arguments object: " +
    "double-quote every key and string value, escape special characters, " +
    "and include only the fields the tool schema declares.";
//# sourceMappingURL=finish-reason.js.map