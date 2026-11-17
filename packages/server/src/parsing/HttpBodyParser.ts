import type { IncomingMessage } from "node:http";
import { HttpError } from "../HttpError.js";
import { HttpHeaderName } from "../HttpHeaderName.js";
import { HttpMediaType } from "../HttpMediaType.js";
import { HttpStatusCode } from "../HttpStatusCode.js";
import { parseBinaryBody } from "./parseBinaryBody.js";
import {
  getMultipartBoundary,
  parseMultipartBody,
} from "./parseMultipartBody.js";
import { parseJsonBody } from "./parseJsonBody.js";
import { parseUrlEncodedBody } from "./parseUrlEncodedBody.js";

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
        `Content-Type must be ${HttpMediaType.ApplicationJson}, ${HttpMediaType.ApplicationUrlEncoded}, ${HttpMediaType.ApplicationOctetStream}, or ${HttpMediaType.MultipartFormData}`,
      );
    }

    const multipartBoundary =
      bodyFormat === "multipart"
        ? getMultipartBoundary(req.headers[HttpHeaderName.ContentType])
        : undefined;
    if (bodyFormat === "multipart" && multipartBoundary === undefined) {
      req.resume();
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Invalid multipart/form-data boundary",
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

    switch (bodyFormat) {
      case "urlencoded":
        return parseUrlEncodedBody<T>(body);
      case "binary":
        return parseBinaryBody<T>(body);
      case "multipart":
        return parseMultipartBody(body, multipartBoundary!) as T;
      case "json":
        return parseJsonBody<T>(body);
    }
  }

  private getBodyFormat(contentType: string | undefined) {
    const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType === HttpMediaType.ApplicationUrlEncoded) return "urlencoded";
    if (mediaType === HttpMediaType.ApplicationOctetStream) return "binary";
    if (mediaType === HttpMediaType.MultipartFormData) return "multipart";
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
}
