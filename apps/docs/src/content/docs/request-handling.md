---
title: Request and response handling
description: Validate request sources, parse bounded bodies, use cookies, and stream data.
---

Each handler receives an `HttpContext` with `req`, `res`, `cookies`, `container`,
`state`, and an abort `signal`. `context.req.url` is a `URL`; `path` excludes
the query string, and `params` contains decoded route parameters.

## Routes and parameters

`@HttpResource(path?)` marks a resource class. Resource-valued fields mount
nested resources, and `@HttpGet`, `@HttpPost`, `@HttpPut`, `@HttpPatch`, and
`@HttpDelete` register handlers. Use `@HttpMethod("METHOD", options)` for other
methods. A `path` on a route is relative to its resource:

```ts
@HttpResource("users")
class UsersResource {
  @HttpGet({ path: ":userId" })
  getUser(context: HttpContext) {
    return { id: context.req.params.userId };
  }
}
```

Route parameters use `:name` for one required segment, `:name?` for an optional
final segment, and `:name*` for zero or more trailing segments (captured as a
decoded string joined with `/`). Static routes take precedence. `HEAD` uses an
explicit handler or falls back to `GET` with its response body suppressed. An
unhandled `OPTIONS` request is answered with `204` and `Allow`; a known path with
an unsupported method returns `405`, and an unknown path returns `404`.

Handlers may return values directly (strings are sent as text, other values as
JSON) or return `new HttpResult(status, body, headers)` to specify status,
headers, or an empty body.

## Parse and validate bodies

`await context.req.parseBody()` parses a request body once and reuses the
resulting promise. The default body limit is 1 MiB; pass a byte limit or
`{ maxBytes }` to change it. Supported content types are JSON and `+json`,
URL-encoded forms, multipart forms, and `application/octet-stream` (a `Buffer`).
Form fields are strings; repeated names become arrays. Multipart files have
`{ filename, contentType, data }`, with `data` as a `Buffer`.

Missing or unsupported content types return `415`, malformed or interrupted
bodies return `400`, and bodies over the configured limit return `413`. If a
route declares a `body` model, the server validates it before invoking the
handler:

```ts
@HttpPost({ body: CreateUser, response: UserResponse })
async create(context: HttpContext) {
  const input = await context.req.parseBody<CreateUser>();
  return createUser(input);
}
```

Invalid model data returns `422` with field-path issues. A response model
validates and shapes JSON output, stripping undeclared fields; use
`response: { arrayOf: UserResponse }` for a list. Response models do not apply
to streams or raw responses.

## Combine path, query, header, and body values

For one validated request object, declare each source in `@Field` metadata.
Query, path, and header values arrive as strings and are converted for numeric
and boolean field types; `ArrayOf` supports repeated query parameters. A body is
a nested model:

```ts
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

  @Field({ type: UUID, optional: true, source: "header", sourceName: "x-client-id" })
  clientId?: string;

  @Field({ model: CreateUserBody, source: "body" })
  body!: CreateUserBody;
}

@HttpPost({ path: ":userId", request: CreateUserRequest })
async create(context: HttpContext) {
  const request = await context.req.model(CreateUserRequest);
  return request;
}
```

The router validates declared request models before the handler; calling
`context.req.model()` returns the cached model. Invalid path/query/header or
body fields return `422`, while body parsing retains its `400`, `413`, and `415`
errors. OpenAPI parameters and request-body schema are derived from this
metadata. The older server-only `@PathParam`, `@QueryParam`, `@HeaderParam`, and
`@Body` decorators are also available for compatibility.

## Cookies

`context.cookies.get(name)` reads a percent-decoded request cookie;
`getAll(name)` returns repeated values. `set()` appends a `Set-Cookie` header and
`clear()` expires a cookie:

```ts
context.cookies.set("session", sessionToken, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 3600,
});
```

Options include `maxAge` in seconds, `expires`, `domain`, `path`, `httpOnly`,
`secure`, and `sameSite`. When clearing, pass the same path and domain used to
set the cookie. `SameSite=None`, `__Secure-`, and `__Host-` enforce required
secure/scope settings. Duplicate names are ambiguous with `get()`; use
`getAll()`. Malformed cookie headers return `400` when read. Cookie transport is
provided, but session storage, token signing, and authentication policy are the
application's responsibility.

## Stream responses and large uploads

Return an async generator to stream strings or `Uint8Array` chunks with
backpressure, rather than buffering the entire response. Set a content type
explicitly; streams otherwise use `application/octet-stream`:

```ts
@HttpGet({ path: "events" })
async *events(context: HttpContext) {
  context.res.setHeader("content-type", "text/event-stream; charset=utf-8");
  yield "event: ready\ndata: connected\n\n";
}
```

For uploads, `context.req.streamBody({ maxBytes })` returns a one-shot Node
readable stream, defaulting to the same 1 MiB limit. Pipe it directly to storage
using `node:stream/promises` `pipeline()` to preserve backpressure, and pass
`context.signal` to cancel work when the client disconnects. The body can be
consumed only once, either buffered with `parseBody()` or streamed. Limits are
checked against both `Content-Length` and received bytes. Treat client filenames
and content types as untrusted; choose storage paths on the server. Multipart
parsing is buffered and is intended for smaller uploads.
