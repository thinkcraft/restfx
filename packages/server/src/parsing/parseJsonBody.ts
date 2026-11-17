import { HttpError } from "../HttpError.js";
import { HttpStatusCode } from "../HttpStatusCode.js";

export function parseJsonBody<T>(body: Buffer): T {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(HttpStatusCode.BadRequest, "Invalid JSON request body");
  }
}
