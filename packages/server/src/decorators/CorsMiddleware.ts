import { HttpResult } from "../HttpResult.js";
import type { HttpResponse } from "../HttpResponse.js";
import { HttpStatusCode } from "../HttpStatusCode.js";
import {
  registerResourceRequestMiddleware,
  type HttpMiddlewareHandler,
} from "../metadata/ResourceMetadata.js";
import type { Route } from "../routing/Route.js";

const httpTokenPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export interface CorsMiddlewareOptions {
  /** Allowed origins or host patterns. `*.example.com` matches subdomains only. */
  readonly origins: readonly string[];
  /** Methods allowed by preflight. Defaults to the methods registered on the resource. */
  readonly methods?: readonly string[];
  /** Allowed request headers. By default, preflight-requested headers are reflected. */
  readonly allowedHeaders?: readonly string[];
  /** Response headers available to browser JavaScript. */
  readonly exposedHeaders?: readonly string[];
  readonly credentials?: boolean;
  /** How long, in seconds, browsers may cache a preflight response. */
  readonly maxAge?: number;
}

type OriginPattern =
  | { readonly type: "exact"; readonly origin: string }
  | {
      readonly type: "domain";
      readonly hostname: string;
      readonly protocol?: string;
      readonly port?: string;
    };

interface NormalizedCorsOptions {
  readonly origins: readonly OriginPattern[];
  readonly methods?: readonly string[];
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly credentials: boolean;
  readonly maxAge?: number;
}

/** Adds CORS response headers for requests from configured origins. */
export function CorsMiddleware(options: CorsMiddlewareOptions) {
  const normalizedOptions = normalizeOptions(options);

  return (resource: Function, _context: ClassDecoratorContext) => {
    registerResourceRequestMiddleware(resource, ({ routes }) =>
      createCorsRequestMiddleware(routes, normalizedOptions),
    );
  };
}

/** @internal Creates the request interceptor for a resource's configured CORS policy. */
function createCorsRequestMiddleware(
  routes: readonly Route[],
  options: NormalizedCorsOptions,
): HttpMiddlewareHandler {
  const methods = options.methods ?? getRouteMethods(routes);

  return (context, next) => {
    addVary(context.res, "Origin");

    const requestOrigin = getSingleHeader(context.req.headers.origin);
    const origin = requestOrigin
      ? parseRequestOrigin(requestOrigin)
      : undefined;
    if (
      !origin ||
      !options.origins.some((pattern) => matchesOrigin(pattern, origin))
    ) {
      return next();
    }

    context.res.setHeader("Access-Control-Allow-Origin", origin.origin);
    if (options.credentials) {
      context.res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    if (context.req.method !== "OPTIONS") {
      if (options.exposedHeaders?.length) {
        context.res.setHeader(
          "Access-Control-Expose-Headers",
          options.exposedHeaders.join(", "),
        );
      }
      return next();
    }

    const requestedMethod = getSingleHeader(
      context.req.headers["access-control-request-method"],
    );
    if (!requestedMethod) return next();

    addVary(context.res, "Access-Control-Request-Method");
    addVary(context.res, "Access-Control-Request-Headers");

    if (!httpTokenPattern.test(requestedMethod)) {
      return new HttpResult(HttpStatusCode.Forbidden);
    }

    const normalizedMethod = requestedMethod.toUpperCase();
    if (!methods.includes(normalizedMethod)) {
      return new HttpResult(HttpStatusCode.Forbidden);
    }

    const requestedHeaders = parseRequestedHeaders(
      getSingleHeader(context.req.headers["access-control-request-headers"]),
    );
    if (!requestedHeaders) return new HttpResult(HttpStatusCode.Forbidden);

    if (
      options.allowedHeaders &&
      requestedHeaders.some(
        (header) =>
          !options.allowedHeaders?.some(
            (allowed) => allowed.toLowerCase() === header.toLowerCase(),
          ),
      )
    ) {
      return new HttpResult(HttpStatusCode.Forbidden);
    }

    context.res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
    const allowedHeaders = options.allowedHeaders ?? requestedHeaders;
    if (allowedHeaders.length > 0) {
      context.res.setHeader(
        "Access-Control-Allow-Headers",
        allowedHeaders.join(", "),
      );
    }
    if (options.maxAge !== undefined) {
      context.res.setHeader("Access-Control-Max-Age", String(options.maxAge));
    }

    return new HttpResult(HttpStatusCode.NoContent);
  };
}

function normalizeOptions(
  options: CorsMiddlewareOptions,
): NormalizedCorsOptions {
  if (
    !options ||
    !Array.isArray(options.origins) ||
    options.origins.length === 0
  ) {
    throw new TypeError("CORS middleware requires at least one allowed origin");
  }

  const origins = options.origins.map(parseOriginPattern);
  const methods =
    options.methods === undefined
      ? undefined
      : normalizeHttpTokenList("method", options.methods);
  const allowedHeaders =
    options.allowedHeaders === undefined
      ? undefined
      : normalizeHttpTokenList("header", options.allowedHeaders);
  const exposedHeaders =
    options.exposedHeaders === undefined
      ? undefined
      : normalizeHttpTokenList("header", options.exposedHeaders);

  if (
    options.maxAge !== undefined &&
    (!Number.isSafeInteger(options.maxAge) || options.maxAge < 0)
  ) {
    throw new TypeError("CORS maxAge must be a non-negative safe integer");
  }

  return {
    origins,
    ...(methods === undefined ? {} : { methods }),
    ...(allowedHeaders === undefined ? {} : { allowedHeaders }),
    ...(exposedHeaders === undefined ? {} : { exposedHeaders }),
    credentials: options.credentials ?? false,
    ...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
  };
}

function normalizeHttpTokenList(label: string, values: readonly string[]) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`CORS ${label} list must not be empty`);
  }
  return values.map((value) => {
    if (typeof value !== "string" || !httpTokenPattern.test(value)) {
      throw new TypeError(`CORS ${label} must be a valid HTTP token`);
    }
    return label === "method" ? value.toUpperCase() : value;
  });
}

function parseOriginPattern(value: string): OriginPattern {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    throw new TypeError(
      "CORS origins must be non-empty origin or domain patterns",
    );
  }

  if (!value.includes("*")) {
    const url = parseOriginUrl(value);
    return { type: "exact", origin: url.origin };
  }

  const match = /^(?:(https?):\/\/)?\*\.(.+)$/i.exec(value);
  if (!match || match[2]?.includes("*") || /[/?#@]/.test(match[2] ?? "")) {
    throw new TypeError(`Invalid CORS origin pattern: ${value}`);
  }

  const protocol = match[1] ? `${match[1].toLowerCase()}:` : undefined;
  const candidate = parseOriginUrl(
    `${protocol ?? "http:"}//cors-wildcard.${match[2]}`,
  );
  const marker = "cors-wildcard.";
  if (!candidate.hostname.startsWith(marker)) {
    throw new TypeError(`Invalid CORS origin pattern: ${value}`);
  }

  const hostname = candidate.hostname.slice(marker.length);
  if (!hostname || hostname.includes("..")) {
    throw new TypeError(`Invalid CORS origin pattern: ${value}`);
  }

  return {
    type: "domain",
    hostname,
    ...(protocol === undefined ? {} : { protocol }),
    ...(/:\d+$/.test(match[2] ?? "") ? { port: candidate.port } : {}),
  };
}

function parseOriginUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Invalid CORS origin: ${value}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError(`Invalid CORS origin: ${value}`);
  }
  return url;
}

function parseRequestOrigin(value: string) {
  if (value === "null") return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    return {
      origin: url.origin,
      hostname: url.hostname,
      protocol: url.protocol,
      port: url.port,
    };
  } catch {
    return undefined;
  }
}

function matchesOrigin(
  pattern: OriginPattern,
  origin: NonNullable<ReturnType<typeof parseRequestOrigin>>,
) {
  if (pattern.type === "exact") return pattern.origin === origin.origin;
  return (
    (pattern.protocol === undefined || pattern.protocol === origin.protocol) &&
    (pattern.port === undefined || pattern.port === origin.port) &&
    origin.hostname !== pattern.hostname &&
    origin.hostname.endsWith(`.${pattern.hostname}`)
  );
}

function getRouteMethods(routes: readonly Route[]) {
  const methods = new Set(routes.map((route) => route.method.toUpperCase()));
  if (methods.has("GET")) methods.add("HEAD");
  methods.add("OPTIONS");
  return [...methods];
}

function getSingleHeader(value: string | readonly string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function parseRequestedHeaders(value: string | undefined) {
  if (value === undefined || value.trim() === "") return [];
  const headers = value.split(",").map((header) => header.trim());
  if (headers.some((header) => !httpTokenPattern.test(header)))
    return undefined;
  return headers;
}

function addVary(response: HttpResponse, value: string) {
  const current = response.res.getHeader("vary");
  const values = Array.isArray(current)
    ? current.flatMap((item) => String(item).split(","))
    : typeof current === "string"
      ? current.split(",")
      : [];
  if (values.some((item) => item.trim() === "*")) return;
  if (values.some((item) => item.trim().toLowerCase() === value.toLowerCase()))
    return;
  values.push(value);
  response.setHeader(
    "vary",
    values
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", "),
  );
}
