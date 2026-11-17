import {
  registerResourceRequestMiddleware,
  type HttpMiddlewareHandler,
} from "../metadata/ResourceMetadata.js";
import { HttpHeaderName } from "../HttpHeaderName.js";
import { HttpResult } from "../HttpResult.js";
import { HttpStatusCode } from "../HttpStatusCode.js";
import { HttpMediaType } from "../HttpMediaType.js";
import { createOpenApiDocument } from "../openapi/createOpenApiDocument.js";
import type { OpenApiDocument, OpenApiOptions } from "../openapi/types.js";
import { normalizePath } from "../routing/normalizePath.js";
import type { Route } from "../routing/Route.js";

/** Intercepts requests for the OpenAPI document and an optional reference UI. */
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
  const path = normalizeOpenApiPath(configuredPath, "OpenAPI endpoint");
  const uiPath = options.ui
    ? normalizeOpenApiPath(options.ui.path ?? "/docs", "OpenAPI UI")
    : undefined;
  if (uiPath === path) {
    throw new TypeError("OpenAPI UI path must differ from the document path");
  }
  let document: OpenApiDocument | undefined;

  return (context, next) => {
    const isDocumentRequest = context.req.path === path;
    const isUiRequest = uiPath !== undefined && context.req.path === uiPath;
    if (!isDocumentRequest && !isUiRequest) return next();

    switch (context.req.method) {
      case "GET":
      case "HEAD":
        if (isUiRequest) {
          return new HttpResult(200, createScalarUi(path), {
            [HttpHeaderName.ContentType]: `${HttpMediaType.TextHtml}; charset=utf-8`,
          });
        }
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

function normalizeOpenApiPath(configuredPath: string, label: string) {
  if (
    !configuredPath.startsWith("/") ||
    configuredPath.includes("?") ||
    configuredPath.includes("#")
  ) {
    throw new TypeError(`${label} path must be an absolute URL path`);
  }
  return normalizePath(configuredPath);
}

function createScalarUi(documentPath: string) {
  const scalarOptions = JSON.stringify({ url: documentPath })
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

  return `<!doctype html>
<html>
  <head>
    <title>API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>Scalar.createApiReference('#app', ${scalarOptions});</script>
  </body>
</html>`;
}
