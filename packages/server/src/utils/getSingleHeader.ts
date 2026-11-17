import type { IncomingMessage } from "node:http";
import { HttpError } from "../HttpError.js";
import { HttpStatusCode } from "../HttpStatusCode.js";

export function getSingleHeader(
  req: IncomingMessage,
  name: string,
  options: { readonly rejectCommaSeparatedValues?: boolean } = {},
) {
  const normalizedName = name.toLowerCase();
  let value: string | undefined;
  let found = false;

  const rawHeaders = req.rawHeaders;
  if (rawHeaders) {
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() !== normalizedName) continue;
      if (found) throw multipleHeadersError(name);
      value = rawHeaders[index + 1] ?? "";
      found = true;
    }
  }

  if (!found) {
    const header = req.headers[normalizedName];
    if (Array.isArray(header)) throw multipleHeadersError(name);
    value = header;
  }

  if (options.rejectCommaSeparatedValues && value?.includes(",")) {
    throw new HttpError(
      HttpStatusCode.BadRequest,
      `Multiple ${name} values are not allowed`,
    );
  }

  return value;
}

function multipleHeadersError(name: string) {
  return new HttpError(
    HttpStatusCode.BadRequest,
    `Multiple ${name} headers are not allowed`,
  );
}
