import { HttpError } from "../HttpError.js";
import { HttpMediaType } from "../HttpMediaType.js";
import { HttpStatusCode } from "../HttpStatusCode.js";

export interface HttpMultipartFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export type HttpMultipartValue = string | HttpMultipartFile;
export type HttpMultipartData = Record<
  string,
  HttpMultipartValue | HttpMultipartValue[]
>;

export function getMultipartBoundary(contentType: string | undefined) {
  if (contentType === undefined) return undefined;
  const parameters = parseHeaderParameters(contentType);
  const boundary = parameters?.get("boundary");
  if (
    boundary === undefined ||
    boundary.length === 0 ||
    boundary.length > 70 ||
    !/^[0-9a-zA-Z'()+_,.\-/:=? ]+$/.test(boundary) ||
    boundary.endsWith(" ")
  ) {
    return undefined;
  }
  return boundary;
}

export function parseMultipartBody(
  body: Buffer,
  boundary: string,
): HttpMultipartData {
  const marker = Buffer.from(`--${boundary}`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  const fields = new Map<string, HttpMultipartValue | HttpMultipartValue[]>();

  // Multipart permits an optional preamble before its first boundary.
  let firstBoundary = body.indexOf(marker);
  while (firstBoundary >= 0) {
    const isLineStart =
      firstBoundary === 0 ||
      (firstBoundary >= 2 &&
        body.subarray(firstBoundary - 2, firstBoundary).toString() === "\r\n");
    const suffix = body
      .subarray(
        firstBoundary + marker.length,
        firstBoundary + marker.length + 2,
      )
      .toString();
    if (isLineStart && (suffix === "--" || suffix === "\r\n")) break;
    firstBoundary = body.indexOf(marker, firstBoundary + 1);
  }
  if (firstBoundary < 0) throw invalidMultipart();
  let position = firstBoundary + marker.length;

  while (true) {
    if (body.subarray(position, position + 2).toString() === "--") {
      const closingSuffix = position + 2;
      if (
        closingSuffix !== body.length &&
        body.subarray(closingSuffix, closingSuffix + 2).toString() !== "\r\n"
      ) {
        throw invalidMultipart();
      }
      return Object.fromEntries(fields);
    }
    if (body.subarray(position, position + 2).toString() !== "\r\n") {
      throw invalidMultipart();
    }

    const headersStart = position + 2;
    const headersEnd = body.indexOf(Buffer.from("\r\n\r\n"), headersStart);
    if (headersEnd < 0) throw invalidMultipart();
    const headers = parseMultipartHeaders(
      body.subarray(headersStart, headersEnd).toString("latin1"),
    );
    const disposition = headers.get("content-disposition");
    const dispositionParameters =
      disposition === undefined
        ? undefined
        : parseHeaderParameters(disposition);
    if (
      dispositionParameters?.get("")?.toLowerCase() !== "form-data" ||
      !dispositionParameters.has("name")
    ) {
      throw invalidMultipart();
    }

    const dataStart = headersEnd + 4;
    let boundaryStart = body.indexOf(separator, dataStart);
    while (boundaryStart >= 0) {
      const suffixStart = boundaryStart + separator.length;
      const suffix = body.subarray(suffixStart, suffixStart + 2).toString();
      if (suffix === "--" || suffix === "\r\n") break;
      boundaryStart = body.indexOf(separator, boundaryStart + 1);
    }
    if (boundaryStart < 0) throw invalidMultipart();

    const name = dispositionParameters.get("name")!;
    const filename = dispositionParameters.get("filename");
    const value: HttpMultipartValue =
      filename === undefined
        ? body.subarray(dataStart, boundaryStart).toString("utf8")
        : {
            filename,
            contentType:
              headers.get("content-type") ??
              HttpMediaType.ApplicationOctetStream,
            data: body.subarray(dataStart, boundaryStart),
          };
    const existing = fields.get(name);
    if (existing === undefined) {
      fields.set(name, value);
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      fields.set(name, [existing, value]);
    }

    position = boundaryStart + separator.length;
  }
}

function parseMultipartHeaders(rawHeaders: string) {
  const headers = new Map<string, string>();
  if (rawHeaders.length === 0) throw invalidMultipart();

  for (const line of rawHeaders.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw invalidMultipart();
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || headers.has(name)) {
      throw invalidMultipart();
    }
    headers.set(name, value);
  }

  return headers;
}

function parseHeaderParameters(header: string) {
  const segments: string[] = [];
  let segmentStart = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < header.length; index++) {
    const char = header[index]!;
    if (escaped) {
      escaped = false;
    } else if (quoted && char === "\\") {
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ";" && !quoted) {
      segments.push(header.slice(segmentStart, index).trim());
      segmentStart = index + 1;
    }
  }
  if (quoted || escaped) return undefined;
  segments.push(header.slice(segmentStart).trim());

  const parameters = new Map<string, string>();
  parameters.set("", segments[0]!.toLowerCase());
  for (const segment of segments.slice(1)) {
    const equals = segment.indexOf("=");
    if (equals <= 0) return undefined;
    const name = segment.slice(0, equals).trim().toLowerCase();
    let value = segment.slice(equals + 1).trim();
    if (value.startsWith('"')) {
      if (!value.endsWith('"') || value.length < 2) return undefined;
      value = value.slice(1, -1).replace(/\\(.)/g, "$1");
    } else if (value.includes('"')) {
      return undefined;
    }
    if (parameters.has(name)) return undefined;
    parameters.set(name, value);
  }
  return parameters;
}

function invalidMultipart() {
  return new HttpError(
    HttpStatusCode.BadRequest,
    "Invalid multipart/form-data request body",
  );
}
