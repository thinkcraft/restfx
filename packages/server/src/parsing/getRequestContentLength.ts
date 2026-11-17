import type { IncomingMessage } from "node:http";
import { HttpError } from "../HttpError.js";
import { HttpHeaderName } from "../HttpHeaderName.js";
import { HttpStatusCode } from "../HttpStatusCode.js";
import { getSingleHeader } from "../utils/getSingleHeader.js";

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
