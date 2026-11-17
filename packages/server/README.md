# `@framework/server`

`@framework/server` is a Node.js HTTP server with nested resources, Stage 3
decorators, middleware, parameterized routing, and bounded request-body parsing.
It uses Node's `node:http` server; `HttpServer.listen()` returns the underlying
Node `Server` instance.

Pass `serverOptions` to configure Node's `http.createServer()` (for example,
`headersTimeout` or `requestTimeout`). `close({ timeoutMs })` stops accepting
new connections and waits for active requests; if the timeout expires, remaining
connections are force-closed. The timeout is optional, so the default behavior
continues to wait for requests to finish.

Optional `onRequest`, `onResponse`, and `onError` hooks support application
instrumentation. Response metrics include the status code, elapsed time, and
whether the server ended the response. Hook exceptions are ignored so logging
or metrics failures do not alter HTTP behavior. Use `errorHandler` to replace
the default error response while keeping `onError` for reporting:

```ts
const server = new HttpServer(ApiResource, {
  onError(error, context) {
    logger.error({ error, path: context?.req.path });
  },
  onResponse(context, responseMetrics) {
    logger.info({ path: context.req.path, ...responseMetrics });
  },
  errorHandler(error) {
    if (error instanceof HttpError && error.status === 404) {
      return new HttpResult(404, { message: "Not found" });
    }
    return new HttpResult(500, { message: "Request failed" });
  },
});
```

Without an `errorHandler`, `HttpError` responses retain their status and details,
and unexpected errors return a generic `500` response. `errorHandler` is not
called after response headers have been sent.

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

@HttpResource("posts")
class PostsResource {
  @HttpGet()
  list() {
    return [{ id: "1", title: "Hello" }];
  }

  @HttpGet({ path: ":id" })
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
  readonly posts = new PostsResource();
}

const server = new HttpServer(ApiResource);
server.listen(3000);
```

The example provides `GET /api/posts`, `GET /api/posts/:id`, and
`POST /api/posts`. Handler return values are sent as text for strings and JSON
for other values. Return `HttpResult` to set a status, body, and headers
explicitly. `HttpResponse.setHeader(name, value)` sets a response header.

### Streaming responses

Return an async generator directly, or use one as an `HttpResult` body. Each
yielded chunk must be a string or `Uint8Array` (including `Buffer`). Chunks are
written as they are produced with backpressure; they are not collected into a
single body. Set a response `content-type` header explicitly when appropriate;
otherwise streams default to `application/octet-stream`.

```ts
@HttpGet({ path: "events" })
async *events(context: HttpContext) {
  context.res.setHeader("content-type", "text/event-stream; charset=utf-8");
  yield "event: ready\ndata: connected\n\n";
  yield "event: update\ndata: data available\n\n";
}

@HttpGet({ path: "download" })
download() {
  async function* chunks() {
    yield Buffer.from("file contents");
  }

  return new HttpResult(200, chunks(), {
    "content-type": "application/octet-stream",
  });
}
```

For `HEAD` requests and bodyless statuses (`204` and `304`), the generator is
not consumed. If a generator fails after response data has started, the server
closes the connection because it can no longer replace the partial response
with an error response.

## Resources and handlers

- `@HttpResource(path?)` marks a resource class and optionally gives it a path
  prefix. A resource-valued field whose class is decorated with `@HttpResource`
  is discovered and mounted automatically; no field decorator is needed.
- `@HttpResource(path?)` can also decorate a resource-valued field. In that
  case, the field's explicit path takes precedence over the child's class path,
  followed by the field name as a fallback.
- Child resources can be supplied as instances or constructors. Static and
  instance fields are supported.
- `@HttpGet(options?)`, `@HttpPost(options?)`, `@HttpPut(options?)`,
  `@HttpPatch(options?)`, and `@HttpDelete(options?)` register method handlers.
  Set the optional route path in that config object, for example
  `@HttpPost({ path: "users", body: CreatePost })`. `@HttpMethod(method,
options?)` supports other method names with the same options shape. Route
  options can include request and response models.
- The router invokes handlers with an `HttpContext`. `context.req` exposes the
  request and `context.res` exposes the response.

`context.req.url` is a `URL`; `context.req.path` is its pathname without the
query string. `context.req.params` contains decoded route parameters as strings.

### Cookies

Use `context.cookies` to read request cookies and add response cookies. Values
are percent-decoded when read and percent-encoded when set. `get(name)` returns
`undefined` when absent and rejects duplicate names as ambiguous; use
`getAll(name)` when repeated values are expected. `set()` appends a separate
`Set-Cookie` header, and `clear()` expires the cookie. Pass the same `path` and
`domain` used when setting a cookie to clear that specific cookie:

```ts
@HttpPost({ path: "login" })
login(context: HttpContext) {
  context.cookies.set("session", createSessionToken(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  return { ok: true };
}

@HttpPost({ path: "logout" })
logout(context: HttpContext) {
  context.cookies.clear("session", { path: "/" });
  return { ok: true };
}
```

`HttpCookieOptions` supports `maxAge` (seconds), `expires`, `domain`, `path`,
`httpOnly`, `secure`, and `sameSite`. `SameSite=None` and the `__Secure-` and
`__Host-` cookie prefixes enforce their required `Secure`/scope settings. This
API handles cookie transport only; session storage and signing are application
concerns. Malformed request cookie headers return `400` when cookies are read.

## Route parameters and HTTP methods

Parameters use a colon-prefixed name and are required by default:

```ts
@HttpGet({ path: "users/:userId" })
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

Use `@CorsMiddleware(options)` on the root resource to add CORS headers for
matching request origins and handle preflight requests:

```ts
import { CorsMiddleware, HttpResource } from "@framework/server";

@CorsMiddleware({
  origins: ["https://app.example.com", "*.preview.example.com"],
  credentials: true,
  allowedHeaders: ["content-type", "authorization"],
  exposedHeaders: ["x-total-count"],
  maxAge: 600,
})
@HttpResource()
class ApiResource {
  // Routes...
}
```

`origins` accepts exact HTTP(S) origins or domain patterns. A host-only pattern
such as `*.preview.example.com` matches subdomains at any depth, but not the
apex domain; it allows either HTTP or HTTPS and any port. Use a scheme-qualified
pattern such as `https://*.preview.example.com` to restrict the scheme, and
include a port to restrict that too. Matching origins are echoed in
`Access-Control-Allow-Origin` rather than returning `*`, so credentials can be
used safely with an explicit allowlist. Non-matching origins receive no CORS
allow headers.

Preflight methods default to the methods registered on the resource (including
implicit `HEAD` and `OPTIONS`). `methods` can override that list. If
`allowedHeaders` is omitted, requested preflight headers are reflected;
otherwise only configured headers are accepted. `credentials`, `exposedHeaders`,
and `maxAge` are optional. The middleware adds the appropriate `Vary` headers
for origin and preflight request fields.

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

### Shared models

`@Model` and `@Field` are exported by `@framework/core` and can be shared by
server and browser code. Field types encapsulate reusable validation rules;
field options describe presence, defaults, constraints, and documentation:

```ts
import { Email, Field, Model, StringField } from "@framework/core";

@Model()
class CreateUser {
  @Field({ type: Email })
  email!: string;

  @Field({ type: StringField, minLength: 2, maxLength: 80 })
  name!: string;

  @Field({ type: StringField, optional: true, description: "Display name" })
  nickname?: string;
}
```

Fields are required unless `optional: true`; `nullable: true` separately allows
an explicit `null`. A `default` is applied only when a field is omitted. Other
field options include `minimum`, `maximum`, `pattern`, `minItems`, `maxItems`,
`uniqueItems`, `examples`, and `deprecated`. `ArrayOf(FieldType)` composes item
validation. Undeclared fields are stripped by default, so only explicitly
modeled values reach application code. Set `@Model({ unknownFields: "reject" })`
to reject input containing undeclared fields instead.

Attach models to routes to validate buffered request bodies and shape JSON
responses:

```ts
@HttpPost({ path: "users", body: CreateUser, response: UserResponse })
async create(context: HttpContext) {
  const input = await context.req.parseBody<CreateUser>();
  return createUser(input);
}
```

The server validates a declared request model before invoking the handler;
`parseBody()` returns an instance of that model, with undeclared fields stripped
by default. The model constructor is not invoked during validation. Invalid model
data returns `422` with field-path issues. Response models validate JSON results
and strip undeclared fields. They do not apply to raw streamed responses or
streamed request bodies.

### Combined request models

Declare request sources directly in core `@Field` metadata. This lets the same
model describe validation and where the server obtains each value, while the
HTTP parsing remains server-only. Query, path, and header strings are converted
to booleans and numbers when their core field type requires it. Repeated query
values are supported with `ArrayOf`. A body is a nested core model and is
parsed with the same bounded parser as `parseBody()`:

```ts
import {
  ArrayOf,
  BooleanField,
  Field,
  Model,
  StringField,
  UUID,
} from "@framework/core";
import { HttpContext, HttpPost, HttpResource } from "@framework/server";

@Model()
class CreateUserBody {
  @Field({ type: StringField, minLength: 2 })
  name!: string;
}

@Model()
class CreateUserRequest {
  @Field({ type: UUID, source: "path" })
  userId!: string;

  @Field({ type: BooleanField, optional: true, source: "query" })
  dryRun?: boolean;

  @Field({
    type: ArrayOf(StringField),
    optional: true,
    source: "query",
    sourceName: "tag",
  })
  tags?: string[];

  @Field({
    type: UUID,
    optional: true,
    source: "header",
    sourceName: "x-client-id",
  })
  clientId?: string;

  @Field({ model: CreateUserBody, source: "body" })
  body!: CreateUserBody;
}

@HttpResource("users")
class UsersResource {
  @HttpPost({ path: ":userId", request: CreateUserRequest })
  async create(context: HttpContext) {
    const request = await context.req.model(CreateUserRequest);
    return request;
  }
}
```

The field-validation decorators and `validateModel()` are provided by
`@framework/core`. The `@PathParam`, `@QueryParam`, `@HeaderParam`, and `@Body`
decorators remain available from `@framework/server` as compatibility helpers
for server-only request classes.

The router validates configured request models before invoking the handler;
calling `context.req.model(CreateUserRequest)` returns the same cached model
instance. Invalid path/query/header fields return `422`; body parsing retains its
usual `400`, `413`, and `415` errors, and invalid body fields return `422`.
OpenAPI generates path/query/header parameters and the nested request-body schema
from this metadata. The body is still buffered and bounded; use `streamBody()`
for large uploads instead.

### OpenAPI

Install the OpenAPI endpoint as middleware on the root resource. The endpoint is
available on `GET` and `HEAD`, supports `OPTIONS`, and root-resource middleware
still runs before the document response. The document is generated on the first
matching `GET` or `HEAD` request, then cached and reused:

```ts
@OpenApiMiddleware({
  path: "/docs/openapi.json",
  info: { title: "Example API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  securitySchemes: {
    bearerAuth: { type: "http", scheme: "bearer" },
  },
  security: [{ bearerAuth: [] }],
})
@HttpResource()
class ApiResource {}

const server = new HttpServer(ApiResource);
```

To serve an interactive Scalar, Swagger UI, or Redoc CE reference as well, enable the UI
option. It defaults to `/docs`, and loads the document from the configured
OpenAPI endpoint. Select the UI with `type`:

```ts
@OpenApiMiddleware({
  path: "/docs/openapi.json",
  ui: { type: "swagger", path: "/docs" },
  info: { title: "Example API", version: "1.0.0" },
})
@HttpResource()
class ApiResource {}
```

The UI page uses the selected UI's CDN bundle (Scalar from jsDelivr, Swagger UI
from unpkg, or Redoc CE from cdn.redoc.ly); the JSON document endpoint remains
available independently. Set `type` to `"scalar"`, `"swagger"`, or `"redoc"`
to choose a UI. Omit `ui` to serve only the document.

Routes contribute their HTTP methods and paths, inferred required path
parameters, request and response model schemas, and standard request-validation
responses. Optional final path segments are represented by both path variants.
Operation details are fields on the normal route decorator options. Add
query/header/cookie parameters and status-specific responses there as well.
Unless specified, `operationId` defaults to the decorated method name. Optional
path variants receive `Without<Parameter>` and `With<Parameter>` suffixes. IDs
must be unique. Repeated method names receive no default ID; set an explicit
`operationId` when one is needed:

```ts
@HttpGet({ path: ":id",
  summary: "Get a user",
  operationId: "getUser",
  tags: ["users"],
  parameters: [
    { name: "include", in: "query", schema: { type: "boolean" } },
  ],
  responses: { "404": { description: "User not found" } },
})
getUser() {}
```

Built-in field types, `ArrayOf`, and model constraints are translated to JSON
Schema. Use semantic field types such as `UUID` and `Email` instead of a plain
`StringField` when appropriate; their validation and formats (for example,
`format: "uuid"`) are both generated automatically. Custom types can provide a
`schema` fragment in `@Field` options, but that metadata does not replace runtime
validation. Response descriptions and schemas for non-model results should be
declared in route `responses`. The endpoint path must not overlap an application
route. This generates the JSON document only; it does not bundle an API explorer
UI.

### Raw streaming uploads

For large uploads, send one binary object per request and consume the raw body
as a stream instead of using multipart forms. `context.req.streamBody()` returns
a one-shot Node readable stream; it defaults to the same 1 MiB size limit as
`parseBody()`. Set `maxBytes` for a larger upload. Pipe it directly to a file,
socket, or storage client to preserve backpressure:

```ts
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

@HttpPut({ path: ":id/content" })
async upload(context: HttpContext) {
  const destination = createWriteStream(
    serverGeneratedPath(context.req.params.id),
    { flags: "wx" },
  );

  await pipeline(
    context.req.streamBody({ maxBytes: 500 * 1024 * 1024 }),
    destination,
    { signal: context.signal },
  );

  return new HttpResult(201);
}
```

The request body can be consumed only once, either with `streamBody()` or
`parseBody()`. The stream limit is checked against both `Content-Length` and
bytes actually received. Multipart form parsing remains buffered and should be
reserved for smaller payloads. Treat client-provided filenames and content
types as untrusted; choose storage paths on the server.

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

Each request gets a `context.requestId`. The server accepts an incoming
`X-Request-Id` only when it is a 1–128 character HTTP token; otherwise it
generates a UUID. The selected ID is returned in the response header and is
available to the `onRequest`, `onError`, and `onResponse` callbacks. Treat
client-supplied IDs as correlation values, not trusted identity or authorization
data.

The server options expose lifecycle hooks for application logging and
observability. `onResponse` receives status, duration, and completion metrics;
observer exceptions are isolated from request handling. The playground shows a
structured JSON logging example using these hooks.

For a custom callback-based server, use Node's `createServer` from `node:http`
directly. The decorated `HttpServer` API is intended for resource-based
dispatch.

## Benchmarks

Run `pnpm --filter @framework/server bench:http` for a local end-to-end HTTP
benchmark. It exercises JSON and URL-encoded parsing, validated request models,
binary and multipart request bodies; JSON, text, binary, and streaming
responses; and a deeply nested route with named parameters. Results include
requests per second and median time per
request across samples. Set `BENCH_ITERATIONS`, `BENCH_SAMPLES`, and
`BENCH_WARMUP` to adjust the run size. Set `BENCH_CONCURRENCY` to a value
greater than `1` to send requests from that many worker-thread clients;
concurrent runs also report per-request p50, p95, and p99 latency. Run
`pnpm --filter @framework/server bench:http:express` to exercise the same
scenarios and client against Express 5 with its built-in JSON, URL-encoded, and
raw-body parsers plus Multer's in-memory multipart parser. Compare the two runs
on the same Node version and machine; this local end-to-end benchmark is not a
substitute for production traffic tests. The separate `bench:routing` command
measures router matching without HTTP or body parsing overhead. The HTTP
benchmark runs the server in a separate process from its load-generating client.

Pass concurrency directly to the benchmark script with:

```sh
pnpm --filter @framework/server run bench:http -- --concurrency 4
```
