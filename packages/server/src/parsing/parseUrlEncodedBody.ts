export function parseUrlEncodedBody<T>(body: Buffer): T {
  const fields = new Map<string, string | string[]>();
  for (const [key, value] of new URLSearchParams(body.toString("utf8"))) {
    const existing = fields.get(key);
    if (existing === undefined) {
      fields.set(key, value);
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      fields.set(key, [existing, value]);
    }
  }

  return Object.fromEntries(fields) as T;
}
