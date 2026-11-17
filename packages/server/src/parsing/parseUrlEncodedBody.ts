// noinspection ExceptionCaughtLocallyJS

import { HttpError } from "../HttpError.js";
import { HttpStatusCode } from "../HttpStatusCode.js";

const MAX_URL_ENCODED_FIELDS = 10_000;
const MAX_URL_ENCODED_NAME_LENGTH = 1_024;

export function parseUrlEncodedBody<T>(body: Buffer): T {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    const fields = new Map<string, string | string[]>();
    for (const segment of text.split("&")) {
      if (segment === "") continue;
      const separator = segment.indexOf("=");
      const rawKey = separator < 0 ? segment : segment.slice(0, separator);
      const rawValue = separator < 0 ? "" : segment.slice(separator + 1);
      const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      const value = decodeURIComponent(rawValue.replace(/\+/g, " "));
      if (key.length > MAX_URL_ENCODED_NAME_LENGTH) {
        throw new HttpError(
          HttpStatusCode.BadRequest,
          "URL-encoded field name exceeds the maximum allowed length",
        );
      }
      const existing = fields.get(key);
      if (existing === undefined) {
        if (fields.size >= MAX_URL_ENCODED_FIELDS) {
          throw new HttpError(
            HttpStatusCode.BadRequest,
            "URL-encoded request body contains too many fields",
          );
        }
        fields.set(key, value);
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        fields.set(key, [existing, value]);
      }
    }

    return Object.fromEntries(fields) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof TypeError || error instanceof URIError) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Invalid URL-encoded request body",
      );
    }
    throw error;
  }
}
