import type { IncomingMessage } from "node:http";
import { HttpError } from "../HttpError.js";
import { HttpHeaderName } from "../HttpHeaderName.js";
import { HttpStatusCode } from "../HttpStatusCode.js";

export function getRequestContentLength(req: IncomingMessage) {
  const contentLength = getSingleHeader(req, HttpHeaderName.ContentLength);
  const transferEncoding = getSingleHeader(req, "transfer-encoding");

  if (contentLength !== undefined && transferEncoding !== undefined) {
    throw new HttpError(
      HttpStatusCode.BadRequest,
      "Content-Length and Transfer-Encoding cannot be used together",
    );
  }

  if (transferEncoding !== undefined) {
    const encodings = transferEncoding
      .split(",")
      .map((encoding) => encoding.trim().toLowerCase());
    if (encodings.length !== 1 || encodings[0] !== "chunked") {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Invalid Transfer-Encoding header",
      );
    }
  }

  if (contentLength === undefined) return undefined;
  if (!/^\d+$/.test(contentLength)) {
    throw new HttpError(
      HttpStatusCode.BadRequest,
      "Invalid Content-Length header",
    );
  }

  const parsedLength = Number(contentLength);
  if (!Number.isSafeInteger(parsedLength)) {
    throw new HttpError(
      HttpStatusCode.BadRequest,
      "Invalid Content-Length header",
    );
  }
  return parsedLength;
}

function getSingleHeader(req: IncomingMessage, name: string) {
  const normalizedName = name.toLowerCase();
  const rawHeaders = req.rawHeaders;
  if (rawHeaders) {
    const values: string[] = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === normalizedName) {
        values.push(rawHeaders[index + 1] ?? "");
      }
    }
    if (values.length > 1) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        `Multiple ${name} headers are not allowed`,
      );
    }
    if (values.length === 1) return values[0];
  }

  const value = req.headers[normalizedName];
  if (Array.isArray(value)) {
    throw new HttpError(
      HttpStatusCode.BadRequest,
      `Multiple ${name} headers are not allowed`,
    );
  }
  return value;
}
