import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  HttpContext,
  HttpDelete,
  HttpGet,
  HttpMiddleware,
  HttpPost,
  HttpResource,
  HttpResult,
  HttpServer,
} from "../src";

class PostsResource {
  @HttpGet()
  list() {
    return [{ id: 1, title: "First post" }];
  }

  @HttpGet(":id")
  getPost(ctx: HttpContext) {
    return { id: ctx.req.params.id };
  }

  @HttpGet("featured")
  getFeaturedPost() {
    return { id: "featured", type: "static" };
  }

  @HttpGet(":id/comments")
  getComments(ctx: HttpContext) {
    return [
      { id: "c1", parentId: ctx.req.params.id },
      { id: "c2", parentId: ctx.req.params.id },
    ];
  }

  @HttpPost("create")
  create() {
    return new HttpResult(201, { id: 2 });
  }

  @HttpPost("echo")
  async echo(ctx: HttpContext) {
    return ctx.req.parseBody<{ title: string; tags: string[] }>();
  }

  @HttpPost("form")
  async form(ctx: HttpContext) {
    return ctx.req.parseBody<{
      name: string;
      interests: string[];
    }>();
  }

  @HttpPost("binary")
  async binary(ctx: HttpContext) {
    return [...(await ctx.req.parseBody<Buffer>())];
  }

  @HttpDelete()
  remove() {
    return new HttpResult(204);
  }
}

class UsersResource {
  @HttpGet()
  list() {
    return [{ id: "u1" }];
  }
}

@HttpResource("api")
class TestApi {
  @HttpResource()
  static readonly posts = new PostsResource();

  @HttpResource()
  readonly users = new UsersResource();
}

const middlewareTrace: string[] = [];

async function rootMiddleware(
  context: HttpContext,
  next: () => Promise<unknown>,
) {
  middlewareTrace.push("root:before");
  context.res.setHeader("x-root-middleware", "ran");
  const result = await next();
  middlewareTrace.push("root:after");
  return result;
}

async function sharedResourceMiddleware(
  context: HttpContext,
  next: () => Promise<unknown>,
) {
  middlewareTrace.push("resource:before");
  if (context.req.path.endsWith("/blocked")) {
    middlewareTrace.push("resource:blocked");
    return new HttpResult(403, { message: "Blocked by middleware" });
  }

  const result = await next();
  middlewareTrace.push("resource:after");
  return result;
}

@HttpMiddleware(sharedResourceMiddleware)
class MiddlewareItemsResource {
  @HttpGet(":id")
  get(context: HttpContext) {
    middlewareTrace.push("handler");
    return { id: context.req.params.id, path: context.req.path };
  }
}

@HttpMiddleware(sharedResourceMiddleware)
class OtherMiddlewareResource {
  @HttpGet()
  get() {
    middlewareTrace.push("other:handler");
    return { ok: true };
  }
}

@HttpMiddleware(rootMiddleware)
@HttpResource("middleware")
class MiddlewareApi {
  @HttpResource("items")
  readonly items = new MiddlewareItemsResource();

  @HttpResource("other")
  readonly other = new OtherMiddlewareResource();
}

describe("HttpServer resource decorators", () => {
  const server = new HttpServer(TestApi);
  let baseUrl: string;

  before(async () => {
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await server.close();
  });

  it("dispatches to handlers on nested resources", async () => {
    const response = await fetch(`${baseUrl}/api/posts`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ id: 1, title: "First post" }]);
  });

  it("dispatches to handlers on nested route", async () => {
    const response = await fetch(`${baseUrl}/api/posts/1/comments`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      { id: "c1", parentId: "1" },
      { id: "c2", parentId: "1" },
    ]);
  });

  it("registers instance resource fields", async () => {
    const response = await fetch(`${baseUrl}/api/users`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ id: "u1" }]);
  });

  it("supports handler paths and HttpResult status codes", async () => {
    const response = await fetch(`${baseUrl}/api/posts/create`, {
      method: "POST",
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 2 });
  });

  it("parses JSON request bodies", async () => {
    const payload = { title: "A post", tags: ["typescript", "http"] };
    const response = await fetch(`${baseUrl}/api/posts/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), payload);
  });

  it("parses URL-encoded form request bodies", async () => {
    const response = await fetch(`${baseUrl}/api/posts/form`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Jane+Doe&interests=books&interests=music",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      name: "Jane Doe",
      interests: ["books", "music"],
    });
  });

  it("parses binary request bodies without decoding their bytes", async () => {
    const payload = Buffer.from([0x00, 0xff, 0x80, 0x41]);
    const response = await fetch(`${baseUrl}/api/posts/binary`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: payload,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [...payload]);
  });

  it("returns 400 for malformed JSON request bodies", async () => {
    const response = await fetch(`${baseUrl}/api/posts/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid json}",
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      message: "Invalid JSON request body",
    });
  });

  it("returns 415 for unsupported request content types", async () => {
    const response = await fetch(`${baseUrl}/api/posts/echo`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "plain text",
    });

    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), {
      message:
        "Content-Type must be application/json, application/x-www-form-urlencoded, application/octet-stream, or multipart/form-data",
    });
  });

  it("matches and exposes named path parameters", async () => {
    const response = await fetch(`${baseUrl}/api/posts/42`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: "42" });
  });

  it("prefers static routes but falls back to matching parameter routes", async () => {
    const staticResponse = await fetch(`${baseUrl}/api/posts/featured`);
    assert.equal(staticResponse.status, 200);
    assert.deepEqual(await staticResponse.json(), {
      id: "featured",
      type: "static",
    });

    // The static POST route does not handle GET, so the GET parameter route
    // still matches, as it did with the previous router.
    const parameterResponse = await fetch(`${baseUrl}/api/posts/create`);
    assert.equal(parameterResponse.status, 200);
    assert.deepEqual(await parameterResponse.json(), { id: "create" });
  });

  it("returns 204 for empty results", async () => {
    const response = await fetch(`${baseUrl}/api/posts`, { method: "DELETE" });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  });

  it("returns 405 for an unsupported method on a known path", async () => {
    const response = await fetch(`${baseUrl}/api/posts`, { method: "PUT" });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, DELETE");
  });

  it("returns 404 for an unknown path", async () => {
    const response = await fetch(`${baseUrl}/missing`);

    assert.equal(response.status, 404);
  });
});

describe("HttpMiddleware decorator", () => {
  const server = new HttpServer(MiddlewareApi);
  let baseUrl: string;

  before(async () => {
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await server.close();
  });

  it("runs ancestor and resource middleware around the route handler", async () => {
    middlewareTrace.length = 0;
    const response = await fetch(`${baseUrl}/middleware/items/42?view=full`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-root-middleware"), "ran");
    assert.deepEqual(await response.json(), {
      id: "42",
      path: "/middleware/items/42",
    });
    assert.deepEqual(middlewareTrace, [
      "root:before",
      "resource:before",
      "handler",
      "resource:after",
      "root:after",
    ]);
  });

  it("allows middleware to short-circuit a request", async () => {
    middlewareTrace.length = 0;
    const response = await fetch(`${baseUrl}/middleware/items/blocked`);

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      message: "Blocked by middleware",
    });
    assert.deepEqual(middlewareTrace, [
      "root:before",
      "resource:before",
      "resource:blocked",
      "root:after",
    ]);
  });

  it("reuses the same middleware function on different resources", async () => {
    middlewareTrace.length = 0;
    const response = await fetch(`${baseUrl}/middleware/other`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(middlewareTrace, [
      "root:before",
      "resource:before",
      "other:handler",
      "resource:after",
      "root:after",
    ]);
  });
});
