# `@framework/server`

The server package supports both a low-level Node.js server helper and a
resource-based API using Stage 3 decorators.

## Decorated resources

```ts
import {
  HttpContext,
  HttpDelete,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpServer,
  HttpResult,
} from "@framework/server";

class PostsResource {
  @HttpGet()
  getPosts() {
    return [{ id: "1", title: "Hello" }];
  }

  @HttpGet(":id")
  getPost(ctx: HttpContext) {
    return { id: ctx.req.params.id };
  }

  @HttpPost()
  createPost() {
    return new HttpResult(201, { id: "2" });
  }

  @HttpDelete(":id")
  deletePost(ctx: HttpContext) {
    return new HttpResult(204);
  }
}

@HttpResource("api")
class ApiResource {
  @HttpResource()
  readonly posts = new PostsResource();
}

new HttpServer(ApiResource).listen(3000);
```

The class decorator supplies a resource's path prefix. A decorated field mounts
a child resource under the field name by default; pass a path to override it.
HTTP method decorators accept an optional route path, including `:name`
parameters, which are available through `ctx.req.params`. Handler return values
are sent as text for strings and JSON for other values. Return `HttpResult` to
set the status, body, and headers explicitly.
