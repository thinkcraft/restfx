import {
  registerResourceRequestMiddleware,
  type HttpMiddlewareHandler,
} from "../metadata/ResourceMetadata.js";

const httpTokenPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const invalidHeaderValuePattern = /[^\t\x20-\x7e\x80-\xff]/;

const defaultHeaders = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
] as const;

export interface SecurityHeadersMiddlewareOptions {
  /** Content Security Policy value. Omitted by default; set `false` to disable. */
  readonly contentSecurityPolicy?: string | false;
  /**
   * HSTS policy. Omitted by default; enable only when HTTPS is enforced for the
   * host and, when configured, all its subdomains.
   */
  readonly strictTransportSecurity?:
    | {
        readonly maxAge: number;
        readonly includeSubDomains?: boolean;
        readonly preload?: boolean;
      }
    | false;
  /**
   * Headers to set or override. Set a value to `false` to disable one of the
   * default headers or configure additional headers. Dedicated CSP and HSTS
   * options take precedence over matching entries here.
   */
  readonly headers?: Readonly<Record<string, string | false>>;
}

/** Adds configurable security headers to responses from a resource. */
export function SecurityHeadersMiddleware(
  options: SecurityHeadersMiddlewareOptions = {},
) {
  const headers = normalizeHeaders(options);

  return (resource: Function, _context: ClassDecoratorContext) => {
    registerResourceRequestMiddleware(resource, () =>
      createSecurityHeadersRequestMiddleware(headers),
    );
  };
}

function createSecurityHeadersRequestMiddleware(
  headers: readonly (readonly [string, string])[],
): HttpMiddlewareHandler {
  return (context, next) => {
    for (const [name, value] of headers) {
      context.res.setHeader(name, value);
    }
    return next();
  };
}

function normalizeHeaders(options: SecurityHeadersMiddlewareOptions) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(
      "Security headers middleware options must be an object",
    );
  }

  const headers = new Map<string, readonly [string, string]>();
  for (const [name, value] of defaultHeaders) {
    headers.set(name.toLowerCase(), [name, value]);
  }

  applyCustomHeaders(headers, options.headers);
  applyDedicatedHeader(
    headers,
    "content-security-policy",
    "Content-Security-Policy",
    options.contentSecurityPolicy,
    (value) => validateHeaderValue("Content-Security-Policy", value),
  );
  applyDedicatedHeader(
    headers,
    "strict-transport-security",
    "Strict-Transport-Security",
    options.strictTransportSecurity,
    createStrictTransportSecurityValue,
  );

  return [...headers.values()];
}

function applyCustomHeaders(
  headers: Map<string, readonly [string, string]>,
  values: SecurityHeadersMiddlewareOptions["headers"],
) {
  if (values === undefined) return;
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError("Security headers must be provided as an object");
  }
  for (const [name, value] of Object.entries(values)) {
    if (!httpTokenPattern.test(name)) {
      throw new TypeError(`Invalid security header name: ${name}`);
    }
    const normalizedName = name.toLowerCase();
    if (value === false) {
      headers.delete(normalizedName);
    } else if (
      typeof value !== "string" ||
      invalidHeaderValuePattern.test(value)
    ) {
      throw new TypeError(`Invalid value for security header: ${name}`);
    } else {
      headers.set(normalizedName, [name, value]);
    }
  }
}

function applyDedicatedHeader<T>(
  headers: Map<string, readonly [string, string]>,
  normalizedName: string,
  name: string,
  value: T | false | undefined,
  normalize: (value: T) => string,
) {
  if (value === undefined) return;
  if (value === false) {
    headers.delete(normalizedName);
    return;
  }
  headers.set(normalizedName, [name, normalize(value)]);
}

function validateHeaderValue(name: string, value: unknown) {
  if (typeof value !== "string" || invalidHeaderValuePattern.test(value)) {
    throw new TypeError(`Invalid value for security header: ${name}`);
  }
  return value;
}

function createStrictTransportSecurityValue(
  options: Exclude<
    SecurityHeadersMiddlewareOptions["strictTransportSecurity"],
    false | undefined
  >,
) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    !Number.isSafeInteger(options.maxAge) ||
    options.maxAge < 0
  ) {
    throw new TypeError(
      "Strict-Transport-Security maxAge must be a non-negative safe integer",
    );
  }
  if (
    (options.includeSubDomains !== undefined &&
      typeof options.includeSubDomains !== "boolean") ||
    (options.preload !== undefined && typeof options.preload !== "boolean")
  ) {
    throw new TypeError(
      "Strict-Transport-Security options must be boolean when provided",
    );
  }

  return [
    `max-age=${options.maxAge}`,
    ...(options.includeSubDomains ? ["includeSubDomains"] : []),
    ...(options.preload ? ["preload"] : []),
  ].join("; ");
}
