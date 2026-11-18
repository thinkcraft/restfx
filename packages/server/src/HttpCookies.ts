import { HttpError } from "./HttpError.js";
import { HttpResponse } from "./HttpResponse.js";
import { HttpStatusCode } from "./HttpStatusCode.js";

const cookieNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const cookieValuePattern = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/;

export interface HttpCookieOptions {
  /** Cookie lifetime in seconds. Negative values expire the cookie immediately. */
  readonly maxAge?: number;
  readonly expires?: Date;
  readonly domain?: string;
  readonly path?: string;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "strict" | "lax" | "none";
}

/** Reads request cookies and writes response cookies. */
export class HttpCookies {
  private _parsed?: Map<string, string[]>;

  constructor(
    private readonly requestCookieHeader:
      string | readonly string[] | undefined,
    private readonly response: HttpResponse,
  ) {}

  /** Returns a cookie value, or undefined when absent. Duplicate names are rejected as ambiguous. */
  get(name: string): string | undefined {
    validateCookieName(name);
    const values = this.parse().get(name);
    if (values && values.length > 1) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        `Multiple cookies named ${name} are not allowed`,
      );
    }
    return values?.[0];
  }

  /** Returns all values for a cookie name in the order sent by the client. */
  getAll(name: string): readonly string[] {
    validateCookieName(name);
    return [...(this.parse().get(name) ?? [])];
  }

  /** Adds a Set-Cookie header to the response. Each call adds a separate cookie. */
  set(name: string, value: string, options: HttpCookieOptions = {}): void {
    validateCookieName(name);
    if (typeof value !== "string") {
      throw new TypeError("Cookie value must be a string");
    }

    const serialized = [
      `${name}=${encodeURIComponent(value)}`,
      ...(options.path === undefined
        ? []
        : [`Path=${validatePath(options.path)}`]),
      ...(options.domain === undefined
        ? []
        : [`Domain=${validateDomain(options.domain)}`]),
      ...(options.maxAge === undefined
        ? []
        : [`Max-Age=${validateMaxAge(options.maxAge)}`]),
      ...(options.expires === undefined
        ? []
        : [`Expires=${validateExpires(options.expires)}`]),
      ...(options.httpOnly ? ["HttpOnly"] : []),
      ...(options.secure ? ["Secure"] : []),
      ...(options.sameSite === undefined
        ? []
        : [`SameSite=${validateSameSite(options.sameSite)}`]),
    ].join("; ");

    if (options.sameSite === "none" && !options.secure) {
      throw new TypeError("SameSite=None cookies must be Secure");
    }
    if (name.startsWith("__Secure-") && !options.secure) {
      throw new TypeError("__Secure- cookies must be Secure");
    }
    if (
      name.startsWith("__Host-") &&
      (!options.secure || options.path !== "/" || options.domain !== undefined)
    ) {
      throw new TypeError(
        "__Host- cookies must be Secure, use Path=/, and omit Domain",
      );
    }

    this.response.appendHeader("set-cookie", serialized);
  }

  /** Expires a cookie. Supply the same path and domain used when setting it. */
  clear(name: string, options: HttpCookieOptions = {}): void {
    this.set(name, "", {
      ...options,
      maxAge: 0,
      expires: new Date(0),
    });
  }

  private parse() {
    if (this._parsed) return this._parsed;

    const cookies = new Map<string, string[]>();
    const headers = Array.isArray(this.requestCookieHeader)
      ? this.requestCookieHeader
      : this.requestCookieHeader === undefined
        ? []
        : [this.requestCookieHeader];

    for (const header of headers) {
      parseCookieHeader(header, cookies);
    }

    this._parsed = cookies;
    return cookies;
  }
}

function parseCookieHeader(header: string, cookies: Map<string, string[]>) {
  for (const part of header.split(";")) {
    const cookie = part.trim();
    if (cookie === "") continue;
    const [name, value] = parseCookie(cookie);
    const values = cookies.get(name);
    if (values) values.push(value);
    else cookies.set(name, [value]);
  }
}

function parseCookie(cookie: string): [string, string] {
  const separator = cookie.indexOf("=");
  if (separator <= 0) throw malformedCookieHeader();

  const name = cookie.slice(0, separator).trim();
  if (!cookieNamePattern.test(name)) throw malformedCookieHeader();

  let value = cookie.slice(separator + 1).trim();
  if (value.startsWith('"') || value.endsWith('"')) {
    if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
      throw malformedCookieHeader();
    }
    value = value.slice(1, -1);
  }
  if (!cookieValuePattern.test(value)) throw malformedCookieHeader();

  try {
    return [name, decodeURIComponent(value)];
  } catch {
    throw malformedCookieHeader();
  }
}

function validateCookieName(name: string) {
  if (!cookieNamePattern.test(name)) {
    throw new TypeError("Cookie name contains invalid characters");
  }
}

function validatePath(path: string) {
  if (/[\x00-\x1f\x7f;]/.test(path)) {
    throw new TypeError("Cookie path contains invalid characters");
  }
  return path;
}

function validateDomain(domain: string) {
  if (!/^[A-Za-z0-9.-]+$/.test(domain) || domain.includes("..")) {
    throw new TypeError("Cookie domain is invalid");
  }
  return domain;
}

function validateMaxAge(maxAge: number) {
  if (!Number.isSafeInteger(maxAge)) {
    throw new TypeError("Cookie maxAge must be a safe integer");
  }
  return maxAge;
}

function validateExpires(expires: Date) {
  if (!Number.isFinite(expires.getTime())) {
    throw new TypeError("Cookie expires must be a valid Date");
  }
  return expires.toUTCString();
}

function validateSameSite(sameSite: HttpCookieOptions["sameSite"]) {
  switch (sameSite) {
    case "strict":
      return "Strict";
    case "lax":
      return "Lax";
    case "none":
      return "None";
    default:
      throw new TypeError("Cookie sameSite must be strict, lax, or none");
  }
}

function malformedCookieHeader() {
  return new HttpError(HttpStatusCode.BadRequest, "Malformed Cookie header");
}
