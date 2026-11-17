import type { IncomingMessage } from "node:http";
import { HttpError } from "../HttpError.js";
import { HttpHeaderName } from "../HttpHeaderName.js";
import { HttpMediaType } from "../HttpMediaType.js";
import { HttpStatusCode } from "../HttpStatusCode.js";

export class HttpBodyParser {
  async parse<T>(req: IncomingMessage, maxBytes = 1_048_576): Promise<T> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError("maxBytes must be a non-negative safe integer");
    }

    const bodyFormat = this.getBodyFormat(
      req.headers[HttpHeaderName.ContentType],
    );
    if (bodyFormat === undefined) {
      req.resume();
      throw new HttpError(
        HttpStatusCode.UnsupportedMediaType,
        `Content-Type must be ${HttpMediaType.ApplicationJson}, ${HttpMediaType.ApplicationUrlEncoded}, or ${HttpMediaType.ApplicationOctetStream}`,
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
    const contentLength = req.headers[HttpHeaderName.ContentLength];
    if (contentLength !== undefined && Number(contentLength) !== body.length) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Request body length does not match Content-Length",
      );
    }

    if (bodyFormat === "urlencoded") {
      return this.parseUrlEncoded<T>(body);
    }

    if (bodyFormat === "binary") {
      return body as T;
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

  private getBodyFormat(contentType: string | undefined) {
    const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType === HttpMediaType.ApplicationUrlEncoded) return "urlencoded";
    if (mediaType === HttpMediaType.ApplicationOctetStream) return "binary";
    const applicationPrefix = HttpMediaType.ApplicationJson.split("/")[0] + "/";
    if (!mediaType?.startsWith(applicationPrefix)) return undefined;

    const subtype = mediaType.slice(applicationPrefix.length);
    if (
      mediaType === HttpMediaType.ApplicationJson ||
      (subtype.endsWith("+json") && subtype.length > "+json".length)
    ) {
      return "json";
    }

    return undefined;
  }

  private parseUrlEncoded<T>(body: Buffer): T {
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
}
