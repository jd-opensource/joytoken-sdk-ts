/**
 * Recursively merges provider-owned JSON extension objects without assigning
 * semantics to any field. Plain objects are merged; arrays and scalar values
 * are replaced only when the incoming value is actually present.
 */
export function mergeOpaqueObject(
  current: Record<string, unknown> | undefined,
  incoming: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(incoming)) return current;

  const merged: Record<string, unknown> = current === undefined ? {} : { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const previous = merged[key];
    merged[key] = isPlainObject(value)
      ? mergeOpaqueObject(isPlainObject(previous) ? previous : undefined, value)!
      : value;
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
