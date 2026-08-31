/**
 * Sentinel task_id the gateway assigns to the orchestration stage that carries
 * the final, user-facing answer. Non-final stages (search, reasoning, ...)
 * stream intermediate content that should not be concatenated into the reply.
 */
export const ORCHESTRATION_FINAL_TASK_ID = "__final__";
//# sourceMappingURL=types.js.map