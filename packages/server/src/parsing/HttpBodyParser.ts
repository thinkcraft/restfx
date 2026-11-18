import type { IncomingMessage } from "node:http";
import { HttpError } from "../HttpError.js";
import { HttpHeaderName } from "../HttpHeaderName.js";
import { HttpMediaType } from "../HttpMediaType.js";
import { HttpStatusCode } from "../HttpStatusCode.js";
import { parseBinaryBody } from "./parseBinaryBody.js";
import {
  getMultipartBoundary,
  parseHeaderParameters,
  parseMultipartBody,
} from "./parseMultipartBody.js";
import { parseJsonBody } from "./parseJsonBody.js";
import { parseUrlEncodedBody } from "./parseUrlEncodedBody.js";
import { getRequestContentLength } from "./getRequestContentLength.js";
import { getSingleHeader } from "../utils/getSingleHeader.js";

export class HttpBodyParser {
  async parse<T>(req: IncomingMessage, maxBytes = 1_048_576): Promise<T> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError("maxBytes must be a non-negative safe integer");
    }

    const contentLength = getRequestContentLength(req);
    if (contentLength !== undefined && contentLength > maxBytes) {
      req.pause();
      throw this.payloadTooLarge();
    }

    const contentType = getSingleHeader(req, HttpHeaderName.ContentType);
    const bodyFormat = this.getBodyFormat(contentType);
    if (bodyFormat === undefined) {
      req.pause();
      throw new HttpError(
        HttpStatusCode.UnsupportedMediaType,
        `Content-Type must be ${HttpMediaType.ApplicationJson}, ${HttpMediaType.ApplicationUrlEncoded}, ${HttpMediaType.ApplicationOctetStream}, or ${HttpMediaType.MultipartFormData}`,
      );
    }

    const multipartBoundary =
      bodyFormat === "multipart"
        ? getMultipartBoundary(contentType)
        : undefined;
    if (bodyFormat === "multipart" && multipartBoundary === undefined) {
      req.pause();
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Invalid multipart/form-data boundary",
      );
    }

    const body = await readRequestBody(req, maxBytes, contentLength);

    return parseBodyFormat(bodyFormat, body, multipartBoundary) as T;
  }

  private payloadTooLarge() {
    return new HttpError(
      HttpStatusCode.PayloadTooLarge,
      "Request body exceeds the maximum allowed size",
    );
  }

  private getBodyFormat(contentType: string | undefined) {
    if (
      contentType !== undefined &&
      /[\u0000-\u0008\u000a-\u001f\u007f]/.test(contentType)
    ) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Invalid Content-Type header",
      );
    }

    if (contentType === undefined) return undefined;
    const parameters = parseHeaderParameters(contentType);
    if (!parameters) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Invalid Content-Type header",
      );
    }

    const mediaType = parameters.get("")?.toLowerCase();
    if (!mediaType?.includes("/")) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Invalid Content-Type header",
      );
    }
    if (mediaType === HttpMediaType.ApplicationUrlEncoded) return "urlencoded";
    if (mediaType === HttpMediaType.ApplicationOctetStream) return "binary";
    if (mediaType === HttpMediaType.MultipartFormData) return "multipart";
    const applicationPrefix = HttpMediaType.ApplicationJson.split("/")[0] + "/";
    if (!mediaType.startsWith(applicationPrefix)) return undefined;

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

async function readRequestBody(
  req: IncomingMessage,
  maxBytes: number,
  contentLength: number | undefined,
) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        req.pause();
        throw new HttpError(
          HttpStatusCode.PayloadTooLarge,
          "Request body exceeds the maximum allowed size",
        );
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      HttpStatusCode.BadRequest,
      "Request body was interrupted before it was fully received",
    );
  }

  const body =
    chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, totalBytes);
  if (contentLength !== undefined && contentLength !== body.length) {
    throw new HttpError(
      HttpStatusCode.BadRequest,
      "Request body length does not match Content-Length",
    );
  }
  return body;
}

function parseBodyFormat(
  bodyFormat: "urlencoded" | "binary" | "multipart" | "json",
  body: Buffer,
  multipartBoundary: string | undefined,
) {
  switch (bodyFormat) {
    case "urlencoded":
      return parseUrlEncodedBody(body);
    case "binary":
      return parseBinaryBody(body);
    case "multipart":
      return parseMultipartBody(body, multipartBoundary!);
    case "json":
      return parseJsonBody(body);
  }
}
