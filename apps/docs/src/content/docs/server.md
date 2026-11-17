---
title: HTTP server
description: Build Node.js HTTP APIs from resources, handlers, and validated models.
---

The `@restfx/server` package owns Node.js HTTP behavior. Decorated resources
organize routes, while models from `@restfx/core` describe and validate inputs.

## Resources and handlers

Use `@HttpResource(path?)` to define a resource and HTTP method decorators to
register handlers. Resource-valued fields create nested routes:

```ts
import { HttpContext, HttpGet, HttpResource, HttpServer } from "@restfx/server";

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
}

@HttpResource("api")
class ApiResource {
  readonly posts = new PostsResource();
}

const server = new HttpServer(ApiResource);
server.listen(3000);
```

This registers `GET /api/posts` and `GET /api/posts/:id`. Handlers can return
values directly, or use `HttpResult` to set a status, headers, and response body.

Decorated resource-valued fields are discovered and mounted automatically; use
`@HttpResource(path?)` on a field to override the child path. Children can be
provided as instances or constructors, and static or instance fields are
supported. For each matched request, RestFX creates a fresh instance of the
matched (leaf) resource with its no-argument constructor; state on a supplied
leaf instance is not copied. Ancestor resources are shared. Prefer injected
services for shared state and request-scoped state rather than storing request
data on an ancestor resource.

## Request validation

Declare a body model in the route options. The server parses and validates the
body before invoking the handler:

```ts
@HttpPost({ body: CreatePost })
async create(context: HttpContext) {
  const post = await context.req.parseBody<CreatePost>();
  return new HttpResult(201, post);
}
```

The server also supports request models assembled from path, query, header, and
body values. See [request handling](../request-handling/) for parsing formats,
limits, combined request models, cookies, and streaming.

## Middleware, services, and OpenAPI

Resources can use scoped middleware, and an `IocContainer` can provide
singleton or request-lifetime services. The server can generate OpenAPI from
routes and model metadata, with optional interactive documentation UIs. Follow
the guides for [dependency injection](../dependency-injection/),
[middleware and CORS](../middleware/), [OpenAPI](../openapi/), and
[operations](../operations/).

For all server options and behavior, see the
[`@restfx/server` README](https://github.com/thinkcraft/restfx/blob/main/packages/server/README.md).
