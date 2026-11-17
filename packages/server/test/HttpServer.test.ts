import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  HttpContext,
  HttpDelete,
  HttpGet,
  HttpMiddleware,
  HttpMethod,
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

  @HttpGet("required/:id/value")
  getRequiredPost(ctx: HttpContext) {
    return { id: ctx.req.params.id };
  }

  @HttpGet("optional/:id?")
  getOptionalPost(ctx: HttpContext) {
    return {
      hasId: Object.hasOwn(ctx.req.params, "id"),
      id: ctx.req.params.id ?? null,
    };
  }

  @HttpGet("files/:path*")
  getFilePath(ctx: HttpContext) {
    return { path: ctx.req.params.path };
  }

  @HttpGet("stream")
  async *stream() {
    yield "first ";
    yield Buffer.from("chunk");
    yield "!";
  }

  @HttpGet("result-stream")
  resultStream() {
    async function* body() {
      yield "streamed ";
      yield "body";
    }

    return new HttpResult(206, body(), {
      "content-type": "text/plain; charset=utf-8",
    });
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

  it("streams async generator handler results without buffering", async () => {
    const response = await fetch(`${baseUrl}/api/posts/stream`);

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.equal(await response.text(), "first chunk!");
  });

  it("streams an async generator used as an HttpResult body", async () => {
    const response = await fetch(`${baseUrl}/api/posts/result-stream`);

    assert.equal(response.status, 206);
    assert.equal(
      response.headers.get("content-type"),
      "text/plain; charset=utf-8",
    );
    assert.equal(await response.text(), "streamed body");
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

  it("requires parameters unless their route segment has a question mark suffix", async () => {
    const requiredMissing = await fetch(`${baseUrl}/api/posts/required/value`);
    assert.equal(requiredMissing.status, 404);

    const required = await fetch(`${baseUrl}/api/posts/required/42/value`);
    assert.equal(required.status, 200);
    assert.deepEqual(await required.json(), { id: "42" });

    const optionalMissing = await fetch(`${baseUrl}/api/posts/optional`);
    assert.equal(optionalMissing.status, 200);
    assert.deepEqual(await optionalMissing.json(), { hasId: false, id: null });

    const optionalPresent = await fetch(`${baseUrl}/api/posts/optional/42`);
    assert.equal(optionalPresent.status, 200);
    assert.deepEqual(await optionalPresent.json(), { hasId: true, id: "42" });
  });

  it("captures zero or more trailing segments with a star suffix", async () => {
    const emptyWildcard = await fetch(`${baseUrl}/api/posts/files`);
    assert.equal(emptyWildcard.status, 200);
    assert.deepEqual(await emptyWildcard.json(), { path: "" });

    const nestedWildcard = await fetch(
      `${baseUrl}/api/posts/files/images/2026/summer%20trip.png`,
    );
    assert.equal(nestedWildcard.status, 200);
    assert.deepEqual(await nestedWildcard.json(), {
      path: "images/2026/summer trip.png",
    });
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
    assert.equal(response.headers.get("allow"), "GET, DELETE, HEAD, OPTIONS");
  });

  it("automatically serves HEAD using GET resource information without a body", async () => {
    const getResponse = await fetch(`${baseUrl}/api/posts/42`);
    const getBody = await getResponse.text();
    const headResponse = await fetch(`${baseUrl}/api/posts/42`, {
      method: "HEAD",
    });

    assert.equal(headResponse.status, 200);
    assert.equal(await headResponse.text(), "");
    assert.equal(
      headResponse.headers.get("content-length"),
      String(Buffer.byteLength(getBody)),
    );
  });

  it("automatically answers OPTIONS with the methods available on a resource", async () => {
    const response = await fetch(`${baseUrl}/api/posts/42`, {
      method: "OPTIONS",
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
    assert.equal(await response.text(), "");

    const unknown = await fetch(`${baseUrl}/missing`, { method: "OPTIONS" });
    assert.equal(unknown.status, 404);
  });

  it("suppresses bodies for HEAD errors while preserving status and headers", async () => {
    const response = await fetch(`${baseUrl}/api/posts`, { method: "HEAD" });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    assert.ok(Number(response.headers.get("content-length")) > 0);
  });

  it("returns 400 for malformed URL-encoded integration requests", async () => {
    const response = await fetch(`${baseUrl}/api/posts/form`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=%E0%A4%A",
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      message: "Invalid URL-encoded request body",
    });
  });

  it("returns 413 for oversized requests without keeping the connection alive", async () => {
    const response = await fetch(`${baseUrl}/api/posts/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(1_048_577, 0x20),
    });

    assert.equal(response.status, 413);
    assert.equal(response.headers.get("connection"), "close");
    assert.deepEqual(await response.json(), {
      message: "Request body exceeds the maximum allowed size",
    });
  });

  it("returns 404 for an unknown path", async () => {
    const response = await fetch(`${baseUrl}/missing`);

    assert.equal(response.status, 404);
  });
});

let releaseSlowRequest!: () => void;
let notifySlowRequestStarted!: () => void;
const slowRequestStarted = new Promise<void>((resolve) => {
  notifySlowRequestStarted = resolve;
});

class LifecycleResource {
  @HttpGet("slow")
  async slow() {
    notifySlowRequestStarted();
    await new Promise<void>((resolve) => {
      releaseSlowRequest = resolve;
    });
    return new HttpResult(200, { completed: true }, { connection: "close" });
  }

  @HttpMethod("GET", "ready")
  ready() {
    return { ready: true };
  }
}

class ProxyUrlResource {
  @HttpGet()
  getUrl(context: HttpContext) {
    return { origin: context.req.url.origin };
  }
}

class InvalidOptionalParameterResource {
  @HttpGet(":id?/details")
  getDetails() {
    return {};
  }
}

@HttpResource()
class LifecycleApi extends LifecycleResource {}

describe("HttpServer lifecycle", () => {
  it("closes safely before listen and waits for active requests during shutdown", async () => {
    const server = new HttpServer(LifecycleApi);

    await server.close();
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    const pendingResponse = fetch(`http://127.0.0.1:${address.port}/slow`);
    await slowRequestStarted;

    const closePromise = server.close();
    assert.strictEqual(server.close(), closePromise);
    let didClose = false;
    void closePromise.then(() => {
      didClose = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(didClose, false);

    releaseSlowRequest();
    const response = await pendingResponse;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { completed: true });
    await closePromise;
    await server.close();

    const restartedServer = server.listen(0);
    await once(restartedServer, "listening");
    const restartedAddress = restartedServer.address() as AddressInfo;
    const readyResponse = await fetch(
      `http://127.0.0.1:${restartedAddress.port}/ready`,
    );
    assert.equal(readyResponse.status, 200);
    await server.close();
  });
});

describe("HttpServer route validation", () => {
  it("rejects optional parameters that are not the final path segment", () => {
    assert.throws(() => new HttpServer(InvalidOptionalParameterResource), {
      name: "TypeError",
      message: "Optional route parameters must be the final path segment",
    });
  });
});

describe("HttpServer proxy handling", () => {
  it("ignores forwarded headers from untrusted peers by default", async () => {
    const server = new HttpServer(ProxyUrlResource);
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/`, {
        headers: {
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https",
        },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { origin: baseUrl });
    } finally {
      await server.close();
    }
  });

  it("uses validated forwarded headers only when the peer is trusted", async () => {
    let remoteAddress: string | undefined;
    const server = new HttpServer(ProxyUrlResource, {
      trustProxy: (address) => {
        remoteAddress = address;
        return address === "127.0.0.1" || address === "::ffff:127.0.0.1";
      },
    });
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/`, {
        headers: {
          "x-forwarded-host": "public.example:8443",
          "x-forwarded-proto": "https",
        },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        origin: "https://public.example:8443",
      });
      assert.ok(remoteAddress);
    } finally {
      await server.close();
    }
  });

  it("rejects ambiguous or malformed forwarded values from trusted peers", async () => {
    const server = new HttpServer(ProxyUrlResource, {
      trustProxy: () => true,
    });
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      for (const headers of [
        {
          "x-forwarded-host": "public.example, attacker.example",
          "x-forwarded-proto": "https",
        },
        {
          "x-forwarded-host": "public.example/path",
          "x-forwarded-proto": "https",
        },
        {
          "x-forwarded-host": "public.example",
          "x-forwarded-proto": "javascript",
        },
      ]) {
        const response = await fetch(`${baseUrl}/`, { headers });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          message:
            headers["x-forwarded-proto"] === "javascript"
              ? "Invalid forwarded protocol"
              : headers["x-forwarded-host"].includes(",")
                ? "Multiple x-forwarded-host values are not allowed"
                : "Invalid Host header",
        });
      }
    } finally {
      await server.close();
    }
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
