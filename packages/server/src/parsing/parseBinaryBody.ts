export function parseBinaryBody<T>(body: Buffer): T {
  return body as T;
}
