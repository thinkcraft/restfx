import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import {
  HttpContext,
  HttpGet,
  HttpMiddleware,
  HttpResource,
  HttpResult,
  HttpServer,
  OpenApiMiddleware,
} from "../src/index.js";
import { createOpenApiRequestMiddleware } from "../src/decorators/OpenApiMiddleware.js";
import type { OpenApiOptions } from "../src/openapi/types.js";
import type { Route } from "../src/routing/Route.js";

const requestTrace: string[] = [];
let collisionHandlerCalls = 0;

async function auditMiddleware(
  context: HttpContext,
  next: () => Promise<unknown>,
) {
  requestTrace.push(`before:${context.req.path}`);
  context.res.setHeader("x-audit", "ran");
  const result = await next();
  requestTrace.push(`after:${context.req.path}`);
  return result;
}

@OpenApiMiddleware({
  path: "/reference//openapi.json/",
  info: { title: "Middleware test API", version: "1.0.0" },
})
@HttpMiddleware(auditMiddleware)
@HttpResource()
class InterceptedDocsResource {
  @HttpGet("reference/openapi.json")
  docsPathCollision() {
    collisionHandlerCalls++;
    return { from: "route" };
  }

  @HttpGet("health")
  health() {
    return { healthy: true };
  }
}

@OpenApiMiddleware({ info: { title: "Default path API", version: "1" } })
@HttpResource()
class DefaultDocsResource {}

async function withServer(
  resource: new () => object,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = new HttpServer(resource);
  const listeningServer = app.listen(0);
  await once(listeningServer, "listening");
  const address = listeningServer.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

function makeContext(path: string, method: string) {
  return { req: { path, method } } as unknown as HttpContext;
}

function validOptions(overrides: Partial<OpenApiOptions> = {}): OpenApiOptions {
  return {
    info: { title: "Test API", version: "1" },
    ...overrides,
  };
}

describe("OpenApiMiddleware", () => {
  it("normalizes its endpoint, intercepts colliding routes, and runs root middleware", async () => {
    requestTrace.length = 0;
    collisionHandlerCalls = 0;

    await withServer(InterceptedDocsResource, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/reference/openapi.json?download=1`,
      );

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-audit"), "ran");
      const document = (await response.json()) as {
        info: { title: string };
        paths: Record<string, unknown>;
      };
      assert.equal(document.info.title, "Middleware test API");
      assert.ok(document.paths["/reference/openapi.json"]);
      assert.ok(document.paths["/health"]);
      assert.equal(collisionHandlerCalls, 0);
      assert.deepEqual(requestTrace, [
        "before:/reference/openapi.json",
        "after:/reference/openapi.json",
      ]);
    });
  });

  it("supports HEAD, OPTIONS, and method rejection on the docs endpoint", async () => {
    requestTrace.length = 0;

    await withServer(InterceptedDocsResource, async (baseUrl) => {
      const optionsResponse = await fetch(`${baseUrl}/reference/openapi.json`, {
        method: "OPTIONS",
      });
      assert.equal(optionsResponse.status, 204);
      assert.equal(optionsResponse.headers.get("allow"), "GET, HEAD, OPTIONS");
      assert.equal(optionsResponse.headers.get("x-audit"), "ran");

      const headResponse = await fetch(`${baseUrl}/reference/openapi.json`, {
        method: "HEAD",
      });
      assert.equal(headResponse.status, 200);
      assert.match(headResponse.headers.get("content-type") ?? "", /json/);
      assert.equal(await headResponse.text(), "");

      const postResponse = await fetch(`${baseUrl}/reference/openapi.json`, {
        method: "POST",
      });
      assert.equal(postResponse.status, 405);
      assert.equal(postResponse.headers.get("allow"), "GET, HEAD, OPTIONS");
      assert.equal(postResponse.headers.get("x-audit"), "ran");
      assert.equal(collisionHandlerCalls, 0);
    });
  });

  it("defaults to /openapi.json and falls through for unrelated paths", async () => {
    await withServer(DefaultDocsResource, async (baseUrl) => {
      const docsResponse = await fetch(`${baseUrl}/openapi.json`);
      assert.equal(docsResponse.status, 200);
      const document = (await docsResponse.json()) as {
        openapi: string;
        paths: Record<string, unknown>;
      };
      assert.equal(document.openapi, "3.1.0");
      assert.deepEqual(document.paths, {});

      const unrelatedResponse = await fetch(`${baseUrl}/not-openapi.json`);
      assert.equal(unrelatedResponse.status, 404);
    });
  });

  it("validates endpoint paths when the request middleware is created", () => {
    for (const path of [
      "relative.json",
      "/openapi.json?format=json",
      "/openapi.json#docs",
    ]) {
      assert.throws(
        () => createOpenApiRequestMiddleware([], validOptions({ path })),
        /OpenAPI endpoint path must be an absolute URL path/,
      );
    }
  });

  it("falls through exactly once when the request path does not match", async () => {
    const middleware = createOpenApiRequestMiddleware(
      [],
      validOptions({ path: "/docs.json" }),
    );
    const context = makeContext("/elsewhere", "GET");
    let nextCalls = 0;
    const next = async () => {
      nextCalls++;
      return "downstream result";
    };

    assert.equal(await middleware(context, next), "downstream result");
    assert.equal(nextCalls, 1);
  });

  it("does not generate the document for unrelated paths, OPTIONS, or rejected methods", async () => {
    const middleware = createOpenApiRequestMiddleware(
      [],
      validOptions({
        path: "/lazy.json",
        info: { title: "", version: "1" },
      }),
    );
    let nextCalls = 0;
    const next = async () => {
      nextCalls++;
      return undefined;
    };

    assert.equal(
      await middleware(makeContext("/elsewhere", "GET"), next),
      undefined,
    );
    const options = middleware(makeContext("/lazy.json", "OPTIONS"), next);
    assert.ok(options instanceof HttpResult);
    assert.equal(options.status, 204);
    const post = middleware(makeContext("/lazy.json", "POST"), next);
    assert.ok(post instanceof HttpResult);
    assert.equal(post.status, 405);
    assert.equal(nextCalls, 1);

    assert.throws(
      () => middleware(makeContext("/lazy.json", "GET"), next),
      /OpenAPI info requires non-empty title and version/,
    );
  });

  it("generates lazily on the first matching HEAD and reuses that document", async () => {
    const routes: Route[] = [];
    const middleware = createOpenApiRequestMiddleware(
      routes,
      validOptions({ path: "/cached.json" }),
    );
    const headContext = makeContext("/cached.json", "HEAD");
    const getContext = makeContext("/cached.json", "GET");
    const next = async () => {
      throw new Error("Matching docs requests must not fall through");
    };

    assert.equal(
      await middleware(makeContext("/elsewhere", "GET"), async () => "next"),
      "next",
    );
    routes.push({
      method: "GET",
      path: "/items",
      specificity: 1,
      resource: {},
      handler: function listItems() {},
      middlewares: [],
    });

    const first = await middleware(headContext, next);
    routes.length = 0;
    const second = await middleware(getContext, next);

    assert.strictEqual(second, first);
    assert.ok((first as { paths: Record<string, unknown> }).paths["/items"]);
  });

  it("does not cache a failed generation attempt", () => {
    const unsupportedRoute: Route = {
      method: "CONNECT",
      path: "/tunnel",
      specificity: 1,
      resource: {},
      handler: function tunnel() {},
      middlewares: [],
    };
    const routes: Route[] = [unsupportedRoute];
    const middleware = createOpenApiRequestMiddleware(
      routes,
      validOptions({ path: "/retry.json" }),
    );
    const context = makeContext("/retry.json", "GET");
    const next = async () => undefined;

    assert.throws(
      () => middleware(context, next),
      /OpenAPI does not support the HTTP method CONNECT/,
    );

    routes[0] = { ...unsupportedRoute, method: "GET" };
    const document = middleware(context, next) as {
      paths: Record<string, unknown>;
    };
    assert.ok(document.paths["/tunnel"]);
  });
});
