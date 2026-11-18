import type { IncomingMessage } from "node:http";
import { Transform } from "node:stream";
import { HttpError } from "../HttpError.js";
import { HttpStatusCode } from "../HttpStatusCode.js";
import { getRequestContentLength } from "./getRequestContentLength.js";
import {
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  validateMaxRequestBodyBytes,
} from "./requestBodyLimits.js";

export interface HttpRequestBodyStreamOptions {
  /** Maximum number of bytes accepted from the request body. */
  readonly maxBytes?: number;
}

export function createRequestBodyStream(
  req: IncomingMessage,
  options: HttpRequestBodyStreamOptions = {},
) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  validateMaxRequestBodyBytes(maxBytes, "maxBytes");

  const contentLength = getRequestContentLength(req);
  if (contentLength !== undefined && contentLength > maxBytes) {
    req.pause();
    throw payloadTooLarge();
  }

  let totalBytes = 0;
  const body = new Transform({
    transform(chunk: Buffer | Uint8Array | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        req.pause();
        callback(payloadTooLarge());
        return;
      }
      callback(null, buffer);
    },
    flush(callback) {
      if (contentLength !== undefined && contentLength !== totalBytes) {
        callback(
          new HttpError(
            HttpStatusCode.BadRequest,
            "Request body length does not match Content-Length",
          ),
        );
        return;
      }
      callback();
    },
  });

  const onRequestError = () =>
    body.destroy(
      new HttpError(
        HttpStatusCode.BadRequest,
        "Request body was interrupted before it was fully received",
      ),
    );
  const onRequestAborted = () => {
    const error = new Error(
      "Request body was interrupted before it was fully received",
    );
    error.name = "AbortError";
    body.destroy(error);
  };
  const cleanup = () => {
    req.off("error", onRequestError);
    req.off("aborted", onRequestAborted);
    if (!req.complete) {
      req.unpipe(body);
      req.pause();
    }
  };

  req.once("error", onRequestError);
  body.once("close", cleanup);
  if (req.aborted) {
    onRequestAborted();
  } else {
    req.once("aborted", onRequestAborted);
    req.pipe(body);
  }

  return body;
}

function payloadTooLarge() {
  return new HttpError(
    HttpStatusCode.PayloadTooLarge,
    "Request body exceeds the maximum allowed size",
  );
}
