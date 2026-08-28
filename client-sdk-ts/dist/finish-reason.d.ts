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
export declare enum FinishReasonKind {
    /** Unrecognized or empty finish_reason. Treated as a normal stop. */
    Unknown = "unknown",
    /** Clean end of turn: the model produced its final answer. */
    Stop = "stop",
    /** The model asked to call one or more tools. */
    ToolCalls = "tool_calls",
    /** The turn was cut off by a token/length limit. */
    Length = "length",
    /** The turn was blocked by a safety filter. */
    ContentFilter = "content_filter",
    /**
     * The model attempted a tool call but emitted an unparseable/invalid payload
     * that the gateway rejected (the Gemini-family "malformed_function_call"
     * case): the response carries no usable tool_calls even though the model was
     * trying to call one. It is transient and worth retrying with a corrective
     * nudge.
     */
    MalformedToolCall = "malformed_function_call"
}
/**
 * classifyFinishReason maps a raw provider finish_reason string to a
 * provider-neutral FinishReasonKind. Matching is case-insensitive and tolerant
 * of the separator differences seen across vendors (snake_case vs SCREAMING,
 * "toolCalls" etc.), so one entry covers each family. Unknown strings fall
 * through to Unknown, which the loop treats as a benign stop.
 */
export declare function classifyFinishReason(raw: string | null | undefined): FinishReasonKind;
/**
 * malformedToolCallNudge is appended to the transcript as a user turn when a
 * step comes back malformed. It steers the model to retry the tool call with a
 * strictly valid, minimal JSON payload — the most common fix for the
 * Gemini-family malformed_function_call, whose usual cause is invalid JSON in
 * string arguments (unescaped operators, unbalanced braces).
 */
export declare const malformedToolCallNudge: string;
//# sourceMappingURL=finish-reason.d.ts.map