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

const MAX_MULTIPART_PARTS = 1_000;
const MAX_MULTIPART_HEADER_BYTES = 16_384;
const MAX_MULTIPART_HEADERS = 32;
const MAX_MULTIPART_FIELD_NAME_LENGTH = 1_024;
const MAX_MULTIPART_FILENAME_LENGTH = 1_024;

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
  let partCount = 0;

  // Multipart permits an optional preamble before its first boundary.
  const firstBoundary = findInitialBoundary(body, marker);
  if (firstBoundary < 0) throw invalidMultipart();
  let position = firstBoundary + marker.length;

  while (true) {
    if (isClosingBoundary(body, position)) {
      validateClosingBoundary(body, position);
      return Object.fromEntries(fields);
    }
    if (body.subarray(position, position + 2).toString() !== "\r\n") {
      throw invalidMultipart();
    }

    partCount++;
    if (partCount > MAX_MULTIPART_PARTS) throw invalidMultipart();
    position = parseMultipartPart(body, position, separator, fields);
  }
}

function findInitialBoundary(body: Buffer, marker: Buffer) {
  let boundary = body.indexOf(marker);
  while (boundary >= 0) {
    const isLineStart =
      boundary === 0 ||
      (boundary >= 2 &&
        body.subarray(boundary - 2, boundary).toString() === "\r\n");
    const suffix = body
      .subarray(boundary + marker.length, boundary + marker.length + 2)
      .toString();
    if (isLineStart && (suffix === "--" || suffix === "\r\n")) return boundary;
    boundary = body.indexOf(marker, boundary + 1);
  }
  return -1;
}

function isClosingBoundary(body: Buffer, position: number) {
  return body.subarray(position, position + 2).toString() === "--";
}

function validateClosingBoundary(body: Buffer, position: number) {
  const suffixStart = position + 2;
  if (
    suffixStart !== body.length &&
    body.subarray(suffixStart, suffixStart + 2).toString() !== "\r\n"
  ) {
    throw invalidMultipart();
  }
}

function parseMultipartPart(
  body: Buffer,
  position: number,
  separator: Buffer,
  fields: Map<string, HttpMultipartValue | HttpMultipartValue[]>,
) {
  const headersStart = position + 2;
  const headersEnd = body.indexOf(Buffer.from("\r\n\r\n"), headersStart);
  if (
    headersEnd < 0 ||
    headersEnd - headersStart > MAX_MULTIPART_HEADER_BYTES
  ) {
    throw invalidMultipart();
  }

  const headers = parseMultipartHeaders(
    body.subarray(headersStart, headersEnd).toString("latin1"),
  );
  const contentType = headers.get("content-type");
  if (
    contentType !== undefined &&
    !parseHeaderParameters(contentType)?.get("")?.includes("/")
  ) {
    throw invalidMultipart();
  }
  const disposition = parseHeaderParameters(
    headers.get("content-disposition") ?? "",
  );
  const name = getMultipartFieldName(disposition);

  const dataStart = headersEnd + 4;
  const boundaryStart = findPartBoundary(body, separator, dataStart);
  if (boundaryStart < 0) throw invalidMultipart();

  const filename = disposition?.get("filename");
  const value: HttpMultipartValue =
    filename === undefined
      ? decodeMultipartField(body.subarray(dataStart, boundaryStart))
      : {
          filename,
          contentType: contentType ?? HttpMediaType.ApplicationOctetStream,
          data: body.subarray(dataStart, boundaryStart),
        };
  appendMultipartField(fields, name, value);
  return boundaryStart + separator.length;
}

function getMultipartFieldName(disposition: Map<string, string> | undefined) {
  const name = disposition?.get("name");
  if (
    disposition?.get("")?.toLowerCase() !== "form-data" ||
    name === undefined ||
    name.length === 0 ||
    name.length > MAX_MULTIPART_FIELD_NAME_LENGTH ||
    (disposition.get("filename")?.length ?? 0) > MAX_MULTIPART_FILENAME_LENGTH
  ) {
    throw invalidMultipart();
  }
  return name;
}

function findPartBoundary(body: Buffer, separator: Buffer, start: number) {
  let boundary = body.indexOf(separator, start);
  while (boundary >= 0) {
    const suffixStart = boundary + separator.length;
    const suffix = body.subarray(suffixStart, suffixStart + 2).toString();
    if (suffix === "--" || suffix === "\r\n") return boundary;
    boundary = body.indexOf(separator, boundary + 1);
  }
  return -1;
}

function appendMultipartField(
  fields: Map<string, HttpMultipartValue | HttpMultipartValue[]>,
  name: string,
  value: HttpMultipartValue,
) {
  const existing = fields.get(name);
  if (existing === undefined) {
    fields.set(name, value);
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    fields.set(name, [existing, value]);
  }
}

function parseMultipartHeaders(rawHeaders: string) {
  const headers = new Map<string, string>();
  if (rawHeaders.length === 0) throw invalidMultipart();

  const lines = rawHeaders.split("\r\n");
  if (lines.length > MAX_MULTIPART_HEADERS) throw invalidMultipart();

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw invalidMultipart();
    const name = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (
      !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) ||
      headers.has(name) ||
      /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)
    ) {
      throw invalidMultipart();
    }
    headers.set(name, value);
  }

  return headers;
}

function decodeMultipartField(body: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw invalidMultipart();
  }
}

export function parseHeaderParameters(header: string) {
  const segments = splitHeaderParameters(header);
  if (!segments) return undefined;

  const primaryValue = segments[0]?.toLowerCase();
  if (
    primaryValue === undefined ||
    !/^[!#$%&'*+.^_`|~0-9a-z-]+(?:\/[!#$%&'*+.^_`|~0-9a-z-]+)?$/i.test(
      primaryValue,
    )
  ) {
    return undefined;
  }

  const parameters = new Map<string, string>();
  parameters.set("", primaryValue);
  for (const segment of segments.slice(1)) {
    const parameter = parseHeaderParameter(segment);
    if (!parameter || parameters.has(parameter.name)) return undefined;
    parameters.set(parameter.name, parameter.value);
  }
  return parameters;
}

function splitHeaderParameters(header: string) {
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
  return segments;
}

function parseHeaderParameter(segment: string) {
  const equals = segment.indexOf("=");
  if (equals <= 0) return undefined;

  const name = segment.slice(0, equals).trim().toLowerCase();
  let value = segment.slice(equals + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)) return undefined;
  if (value.startsWith('"')) {
    const decoded = decodeQuotedParameter(value);
    if (decoded === undefined) return undefined;
    value = decoded;
  } else if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(value)) {
    return undefined;
  }
  return { name, value };
}

function decodeQuotedParameter(value: string) {
  if (!value.endsWith('"') || value.length < 2) return undefined;

  const quoted = value.slice(1, -1);
  let decoded = "";
  for (let index = 0; index < quoted.length; index++) {
    const char = quoted[index]!;
    if (char === "\\") {
      index++;
      const escaped = quoted[index];
      if (
        escaped === undefined ||
        /[\u0000-\u0008\u000a-\u001f\u007f]/.test(escaped)
      ) {
        return undefined;
      }
      decoded += escaped;
    } else if (
      char === '"' ||
      /[\u0000-\u0008\u000a-\u001f\u007f]/.test(char)
    ) {
      return undefined;
    } else {
      decoded += char;
    }
  }
  return decoded;
}

function invalidMultipart() {
  return new HttpError(
    HttpStatusCode.BadRequest,
    "Invalid multipart/form-data request body",
  );
}
