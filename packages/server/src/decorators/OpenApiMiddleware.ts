import {
  registerResourceRequestMiddleware,
  type HttpMiddlewareHandler,
} from "../metadata/ResourceMetadata.js";
import { HttpHeaderName } from "../HttpHeaderName.js";
import { HttpResult } from "../HttpResult.js";
import { HttpStatusCode } from "../HttpStatusCode.js";
import { createOpenApiDocument } from "../openapi/createOpenApiDocument.js";
import type { OpenApiDocument, OpenApiOptions } from "../openapi/types.js";
import { normalizePath } from "../routing/normalizePath.js";
import type { Route } from "../routing/Route.js";

/** Intercepts requests for a generated OpenAPI document on the root resource. */
export function OpenApiMiddleware(options: OpenApiOptions) {
  return (resource: Function, _context: ClassDecoratorContext) => {
    registerResourceRequestMiddleware(resource, ({ routes }) => {
      return createOpenApiRequestMiddleware(routes, options);
    });
  };
}

/** @internal Creates an interceptor whose closure reuses the generated document. */
export function createOpenApiRequestMiddleware(
  routes: readonly Route[],
  options: OpenApiOptions,
): HttpMiddlewareHandler {
  const configuredPath = options.path ?? "/openapi.json";
  if (
    !configuredPath.startsWith("/") ||
    configuredPath.includes("?") ||
    configuredPath.includes("#")
  ) {
    throw new TypeError("OpenAPI endpoint path must be an absolute URL path");
  }
  const path = normalizePath(configuredPath);
  let document: OpenApiDocument | undefined;

  return (context, next) => {
    if (context.req.path !== path) return next();

    switch (context.req.method) {
      case "GET":
      case "HEAD":
        return (document ??= createOpenApiDocument(routes, options));
      case "OPTIONS":
        return new HttpResult(HttpStatusCode.NoContent, undefined, {
          [HttpHeaderName.Allow]: "GET, HEAD, OPTIONS",
        });
      default:
        return new HttpResult(
          HttpStatusCode.MethodNotAllowed,
          "Method Not Allowed",
          { [HttpHeaderName.Allow]: "GET, HEAD, OPTIONS" },
        );
    }
  };
}
