import type { IncomingMessage } from "node:http";
import { HttpError } from "../HttpError.js";
import { HttpStatusCode } from "../HttpStatusCode.js";

export class HttpBodyParser {
  async parse<T>(req: IncomingMessage, maxBytes = 1_048_576): Promise<T> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError("maxBytes must be a non-negative safe integer");
    }

    if (!this.isJsonContentType(req.headers["content-type"])) {
      req.resume();
      throw new HttpError(
        HttpStatusCode.UnsupportedMediaType,
        "Content-Type must be application/json",
      );
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;

      if (totalBytes > maxBytes) {
        chunks.length = 0;

        throw new HttpError(
          HttpStatusCode.PayloadTooLarge,
          "Request body exceeds the maximum allowed size",
        );
      }

      chunks.push(buffer);
    }

    const body = Buffer.concat(chunks);
    const contentLength = req.headers["content-length"];
    if (contentLength !== undefined && Number(contentLength) !== body.length) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Request body length does not match Content-Length",
      );
    }

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

  private isJsonContentType(contentType: string | undefined) {
    const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (!mediaType?.startsWith("application/")) return false;

    const subtype = mediaType.slice("application/".length);
    return (
      subtype === "json" ||
      (subtype.endsWith("+json") && subtype.length > "+json".length)
    );
  }
}
