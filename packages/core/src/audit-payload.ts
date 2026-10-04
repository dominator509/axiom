/** JSONB-compatible canonical bytes, including every nested value. */
export function canonicalAuditPayload(payload: unknown): string {
  // Normalize Date/undefined/non-finite values exactly as JSON persistence does.
  const value: unknown = JSON.parse(JSON.stringify(payload));
  const encode = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
    if (item !== null && typeof item === 'object') return `{${Object.keys(item).sort()
      .map(key => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`).join(',')}}`;
    return JSON.stringify(item);
  };
  // Domain separation prevents a v2 digest from being mistaken for legacy JSON.
  return `axiom-audit-v2\0${encode(value)}`;
}

/** Historical verification only. This format did not protect arbitrary detail keys. */
export function legacyAuditPayload(payload: unknown): string {
  return JSON.stringify(payload, Object.keys(payload as object).sort());
}
