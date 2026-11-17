# `@framework/server`

`@framework/server` is a Node.js HTTP server with nested resources, Stage 3
decorators, middleware, parameterized routing, and bounded request-body parsing.
It uses Node's `node:http` server; `HttpServer.listen()` returns the underlying
Node `Server` instance.

## Quick start

```ts
import {
  HttpContext,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpResult,
  HttpServer,
} from "@framework/server";

class PostsResource {
  @HttpGet()
  list() {
    return [{ id: "1", title: "Hello" }];
  }

  @HttpGet(":id")
  get(context: HttpContext) {
    return { id: context.req.params.id };
  }

  @HttpPost()
  async create(context: HttpContext) {
    const post = await context.req.parseBody<{ title: string }>();
    return new HttpResult(201, { id: "2", ...post });
  }
}

@HttpResource("api")
class ApiResource {
  @HttpResource("posts")
  readonly posts = new PostsResource();
}

const server = new HttpServer(ApiResource);
server.listen(3000);
```

The example provides `GET /api/posts`, `GET /api/posts/:id`, and
`POST /api/posts`. Handler return values are sent as text for strings and JSON
for other values. Return `HttpResult` to set a status, body, and headers
explicitly. `HttpResponse.setHeader(name, value)` sets a response header.

## Resources and handlers

- `@HttpResource(path?)` marks a resource class and optionally gives it a path
  prefix. It can also decorate a resource-valued field to mount a child.
- A mounted field uses its explicit decorator path, then the child's class
  path, then the field name, in that order.
- Child resources can be supplied as instances or constructors. Static and
  instance fields are supported.
- `@HttpGet(path?)`, `@HttpPost(path?)`, `@HttpPut(path?)`,
  `@HttpPatch(path?)`, and `@HttpDelete(path?)` register method handlers.
  `@HttpMethod(method, path?)` supports other method names.
- The router invokes handlers with an `HttpContext`. `context.req` exposes the
  request and `context.res` exposes the response.

`context.req.url` is a `URL`; `context.req.path` is its pathname without the
query string. `context.req.params` contains decoded route parameters as strings.

## Route parameters and HTTP methods

Parameters use a colon-prefixed name and are required by default:

```ts
@HttpGet("users/:userId")
getUser(context: HttpContext) {
  return { id: context.req.params.userId };
}
```

Supported parameter forms:

- `:name` matches exactly one path segment and is required.
- `:name?` matches zero or one segment. Optional parameters must be the final
  route segment. When omitted, that property is absent from `params`.
- `:name*` matches zero or more trailing segments and captures them as a
  decoded string joined with `/`. Wildcard parameters must be the final route
  segment.

Static routes take precedence over parameter routes. A `HEAD` request uses an
explicit `HEAD` handler when present, otherwise it falls back to `GET` and
suppresses the response body. When no explicit `OPTIONS` handler matches,
`OPTIONS` is answered automatically with `204` and an `Allow` header for known
paths. Unsupported methods on a known path return `405` with `Allow`; unknown
paths return `404`. Unhandled errors from handlers or middleware return `500`.

## Middleware

`@HttpMiddleware(handler)` applies a reusable middleware function to a resource
and its nested resources. Middleware receives `(context, next)` and can inspect
or modify the request/response, await the next handler, or return early to
short-circuit the request. Ancestor middleware runs before middleware attached
to a child resource.

```ts
import {
  HttpGet,
  HttpContext,
  HttpMiddleware,
  HttpResource,
  HttpResult,
} from "@framework/server";

async function requireToken(
  context: HttpContext,
  next: () => Promise<unknown>,
) {
  if (!context.req.headers.authorization) {
    return new HttpResult(401, { message: "Unauthorized" });
  }
  return await next();
}

@HttpMiddleware(requireToken)
@HttpResource("private")
class PrivateResource {
  @HttpGet()
  getSecret() {
    return { secret: "available to authenticated callers" };
  }
}
```

## Request bodies

Use `await context.req.parseBody<T>(maxBytes?)`. The default size limit is
1 MiB; the optional argument overrides it in bytes. The body is parsed once per
request and the resulting promise is reused.

Supported content types:

- `application/json` and `application/*+json`
- `application/x-www-form-urlencoded`
- `application/octet-stream` (returns a `Buffer`)
- `multipart/form-data`

URL-encoded and multipart fields are strings. Repeated field names become
arrays. Multipart files have the shape
`{ filename, contentType, data }`, with `data` as a `Buffer`; the exported
`HttpMultipartData`, `HttpMultipartValue`, and `HttpMultipartFile` types can be
used to describe these results.

Missing or unsupported content types return `415`. Malformed bodies, invalid
framing, and interrupted requests return `400`; bodies over the configured
limit return `413`.

## Reverse proxies

Forwarded headers are ignored by default. To use `X-Forwarded-Host` and
`X-Forwarded-Proto`, provide a predicate that trusts only the actual proxy
peer's socket address:

```ts
const server = new HttpServer(ApiResource, {
  trustProxy: (remoteAddress) =>
    remoteAddress === "10.0.0.10" || remoteAddress === "::ffff:10.0.0.10",
});
```

For trusted peers, forwarded host and protocol values must be singular and
valid; the protocol is limited to `http` or `https`. Configure the proxy to
overwrite or sanitize forwarded headers, and do not trust arbitrary clients.

## Server lifecycle and lower-level use

`server.listen(port = 3000)` returns Node's `http.Server`. `await server.close()`
stops accepting connections and waits for active requests to finish; it is safe
to call before listening.

For a custom callback-based server, use Node's `createServer` from `node:http`
directly. The decorated `HttpServer` API is intended for resource-based
dispatch.
