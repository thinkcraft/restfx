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
  /**
   * Headers to set or override. Set a value to `false` to disable one of the
   * default headers. Content-Security-Policy and Strict-Transport-Security are
   * not set by default because their policies depend on the application and TLS
   * deployment.
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

  if (options.headers !== undefined) {
    if (
      options.headers === null ||
      typeof options.headers !== "object" ||
      Array.isArray(options.headers)
    ) {
      throw new TypeError("Security headers must be provided as an object");
    }

    for (const [name, value] of Object.entries(options.headers)) {
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

  return [...headers.values()];
}
