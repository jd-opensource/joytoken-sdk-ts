/**
 * Recursively merges provider-owned JSON extension objects without assigning
 * semantics to any field. Plain objects are merged; arrays and scalar values
 * are replaced only when the incoming value is actually present.
 */
export function mergeOpaqueObject(current, incoming) {
    if (!isPlainObject(incoming))
        return current;
    const merged = current === undefined ? {} : { ...current };
    for (const [key, value] of Object.entries(incoming)) {
        if (value === undefined)
            continue;
        const previous = merged[key];
        merged[key] = isPlainObject(value)
            ? mergeOpaqueObject(isPlainObject(previous) ? previous : undefined, value)
            : value;
    }
    return merged;
}
function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
//# sourceMappingURL=opaque.js.map