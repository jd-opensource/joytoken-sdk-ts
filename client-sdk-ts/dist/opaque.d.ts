/**
 * Recursively merges provider-owned JSON extension objects without assigning
 * semantics to any field. Plain objects are merged; arrays and scalar values
 * are replaced only when the incoming value is actually present.
 */
export declare function mergeOpaqueObject(current: Record<string, unknown> | undefined, incoming: unknown): Record<string, unknown> | undefined;
//# sourceMappingURL=opaque.d.ts.map