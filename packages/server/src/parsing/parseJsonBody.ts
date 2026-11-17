import { HttpError } from "../HttpError.js";
import { HttpStatusCode } from "../HttpStatusCode.js";

export function parseJsonBody<T>(body: Buffer): T {
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Invalid JSON request body",
      );
    }
    throw error;
  }
}
