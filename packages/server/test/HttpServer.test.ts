import assert from "node:assert/strict";
import { once } from "node:events";
import {
  get as httpGet,
  request as httpRequest,
  ServerResponse,
} from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after, before, describe, it } from "node:test";
import {
  ArrayOf,
  HttpContext,
  HttpDelete,
  HttpGet,
  HttpMiddleware,
  HttpMethod,
  HttpPost,
  HttpPut,
  HttpResource,
  HttpResult,
  HttpServer,
  Email,
  Field,
  Model,
  OpenApiMiddleware,
  StringField,
  UUID,
} from "../src";
import { createOpenApiRequestMiddleware } from "../src/decorators/OpenApiMiddleware.js";

@Model()
class CreateUserModel {
  @Field({ type: Email })
  email!: string;

  @Field({ type: StringField, minLength: 2, maxLength: 40 })
  name!: string;

  @Field({ type: StringField, optional: true })
  nickname?: string;

  @Field({
    type: UUID,
    optional: true,
  })
  externalId?: string;

  @Field({ type: ArrayOf(StringField), optional: true, minItems: 1 })
  roles?: string[];

  @Field({ type: StringField, nullable: true, default: null })
  optionalLabel!: string | null;
}

@Model()
class UserResponseModel {
  @Field({ type: StringField })
  id!: string;

  @Field({ type: Email })
  email!: string;

  @Field({ type: StringField })
  name!: string;
}

@HttpResource("posts")
class PostsResource {
  @HttpGet()
  list() {
    return [{ id: 1, title: "First post" }];
  }

  @HttpGet({
    path: ":id",
    summary: "Get a post",
    operationId: "getPost",
    tags: ["posts"],
    parameters: [
      {
        name: "includeComments",
        in: "query",
        description: "Include comments in the result",
        schema: { type: "boolean", default: false },
      },
      {
        name: "x-client-id",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
    ],
  })
  getPost(ctx: HttpContext) {
    return { id: ctx.req.params.id };
  }

  @HttpGet({ path: "featured" })
  getFeaturedPost() {
    return { id: "featured", type: "static" };
  }

  @HttpGet({ path: ":id/comments" })
  getComments(ctx: HttpContext) {
    return [
      { id: "c1", parentId: ctx.req.params.id },
      { id: "c2", parentId: ctx.req.params.id },
    ];
  }

  @HttpGet({ path: "required/:id/value" })
  getRequiredPost(ctx: HttpContext) {
    return { id: ctx.req.params.id };
  }

  @HttpGet({ path: "optional/:id?" })
  getOptionalPost(ctx: HttpContext) {
    return {
      hasId: Object.hasOwn(ctx.req.params, "id"),
      id: ctx.req.params.id ?? null,
    };
  }

  @HttpGet({ path: "files/:path*" })
  getFilePath(ctx: HttpContext) {
    return { path: ctx.req.params.path };
  }

  @HttpGet({ path: "stream" })
  async *stream() {
    yield "first ";
    yield Buffer.from("chunk");
    yield "!";
  }

  @HttpGet({ path: "result-stream" })
  resultStream() {
    async function* body() {
      yield "streamed ";
      yield "body";
    }

    return new HttpResult(206, body(), {
      "content-type": "text/plain; charset=utf-8",
    });
  }

  @HttpPost({
    path: "create",
    responses: {
      "201": {
        description: "Post created",
        schema: { type: "object", properties: { id: { type: "number" } } },
      },
    },
  })
  create() {
    return new HttpResult(201, { id: 2 });
  }

  @HttpPost({ path: "echo" })
  async echo(ctx: HttpContext) {
    return ctx.req.parseBody<{ title: string; tags: string[] }>();
  }

  @HttpPost({ path: "form" })
  async form(ctx: HttpContext) {
    return ctx.req.parseBody<{
      name: string;
      interests: string[];
    }>();
  }

  @HttpPost({ path: "binary" })
  async binary(ctx: HttpContext) {
    return [...(await ctx.req.parseBody<Buffer>())];
  }

  @HttpDelete()
  remove() {
    return new HttpResult(204);
  }
}

class UsersResource {
  @HttpGet({ response: { arrayOf: UserResponseModel } })
  list() {
    return [
      {
        id: "u1",
        email: "user@example.test",
        name: "User",
        internalRole: "admin",
      },
    ];
  }

  @HttpPost({
    body: CreateUserModel,
    response: UserResponseModel,
    responses: {
      "409": { description: "A user with this email already exists" },
    },
  })
  async create(context: HttpContext) {
    const input = await context.req.parseBody<CreateUserModel>();
    return {
      id: "u2",
      email: input.email,
      name: input.name,
      internalRole: "admin",
    };
  }

  @HttpPost({ path: "instance", body: CreateUserModel })
  async checkBodyInstance(context: HttpContext) {
    const input = await context.req.parseBody<CreateUserModel>();
    return { isInstance: input instanceof CreateUserModel };
  }

  @HttpGet({ path: "invalid-response", response: UserResponseModel })
  invalidResponse() {
    return { id: 123, email: "not-an-email", name: "Invalid" };
  }

  @HttpGet({ path: "writer-response", response: UserResponseModel })
  writerResponse() {
    return new HttpResult(
      200,
      async (sink) => {
        await sink.write(
          JSON.stringify({ id: 123, email: "not-an-email", name: "Invalid" }),
        );
      },
      { "content-type": "application/json" },
    );
  }

  @HttpGet({
    path: "invalid-response-array",
    response: { arrayOf: UserResponseModel },
  })
  invalidResponseArray() {
    return [{ id: "u1", email: "invalid", name: "Invalid" }];
  }

  @HttpGet({
    path: "non-array-response",
    response: { arrayOf: UserResponseModel },
  })
  nonArrayResponse() {
    return { id: "u1", email: "user@example.test", name: "User" };
  }
}

class UploadResource {
  @HttpPut({ path: ":id/content" })
  async upload(context: HttpContext) {
    let bytes = 0;
    let chunks = 0;
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        bytes += chunk.byteLength;
        chunks++;
        callback();
      },
    });

    await pipeline(context.req.streamBody({ maxBytes: 16 }), sink, {
      signal: context.signal,
    });

    return { id: context.req.params.id, bytes, chunks };
  }

  @HttpPut({ path: "limited" })
  async limited(context: HttpContext) {
    await pipeline(
      context.req.streamBody({ maxBytes: 4 }),
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      { signal: context.signal },
    );
    return { uploaded: true };
  }
}

async function parseBodyInRootMiddleware(
  context: HttpContext,
  next: () => Promise<unknown>,
) {
  if (context.req.path === "/middleware-raised") {
    await context.req.parseBody();
  }
  return next();
}

@HttpMiddleware(parseBodyInRootMiddleware)
class RequestBodyLimitResource {
  @HttpPost({ path: "buffered" })
  async buffered(context: HttpContext) {
    return context.req.parseBody(100);
  }

  @HttpPost({ path: "buffered-raised", maxRequestBodyBytes: 16 })
  async bufferedRaised(context: HttpContext) {
    return context.req.parseBody(100);
  }

  @HttpPost({ path: "middleware-raised", maxRequestBodyBytes: 16 })
  async middlewareRaised(context: HttpContext) {
    return context.req.parseBody();
  }

  @HttpPost({
    path: "modeled-raised",
    body: CreateUserModel,
    maxRequestBodyBytes: 128,
  })
  async modeledRaised(context: HttpContext) {
    const body = await context.req.parseBody<CreateUserModel>();
    return { email: body.email };
  }

  @HttpPut({ path: "streamed" })
  async streamed(context: HttpContext) {
    return this.countStreamBytes(context, 100);
  }

  @HttpPut({ path: "streamed-raised", maxRequestBodyBytes: 16 })
  async streamedRaised(context: HttpContext) {
    return this.countStreamBytes(context, 100);
  }

  @HttpPut({ path: "streamed-lowered", maxRequestBodyBytes: 2 })
  async streamedLowered(context: HttpContext) {
    return this.countStreamBytes(context, 100);
  }

  private async countStreamBytes(context: HttpContext, maxBytes: number) {
    let bytes = 0;
    for await (const chunk of context.req.streamBody({ maxBytes })) {
      bytes += Buffer.isBuffer(chunk)
        ? chunk.byteLength
        : Buffer.byteLength(chunk);
    }
    return { bytes };
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

let canceledStreamFinalized = deferred();
let releaseCanceledStream!: () => void;
let pendingStreamStarted = deferred();
let releasePendingStream!: () => void;
let pendingStreamFinalized = deferred();
let noConsumeStreamStarted = 0;
let bodyWriterStarted = 0;
let bodyWriterErrorAfterStarted = deferred();
let releaseBodyWriterErrorAfter!: () => void;
let backpressurePulls = 0;
let releaseErrorAfterFirstChunk!: () => void;
let releaseInvalidAfterFirstChunk!: () => void;
let releaseCleanupError!: () => void;
let cleanupErrorFinalized = deferred();
let errorBeforeFinalized = deferred();
let errorAfterFinalized = deferred();

class StreamingBehaviorResource {
  @HttpGet({ path: "cancel" })
  async *cancel() {
    try {
      yield "first";
      await new Promise<void>((resolve) => {
        releaseCanceledStream = resolve;
      });
      yield "must not be pulled";
    } finally {
      canceledStreamFinalized.resolve();
    }
  }

  @HttpGet({ path: "cancel-cleanup-error" })
  async *cancelWithCleanupError() {
    try {
      yield "first";
      await new Promise<void>((resolve) => {
        releaseCleanupError = resolve;
      });
    } finally {
      cleanupErrorFinalized.resolve();
      // noinspection ThrowInsideFinallyBlockJS
      throw new Error("cleanup failed");
    }
  }

  @HttpGet({ path: "pending" })
  async *pending() {
    try {
      pendingStreamStarted.resolve();
      await new Promise<void>((resolve) => {
        releasePendingStream = resolve;
      });
      yield "late chunk";
    } finally {
      pendingStreamFinalized.resolve();
    }
  }

  @HttpGet({ path: "error-before" })
  async *errorBefore() {
    try {
      throw new Error("stream failed before the first chunk");
      // noinspection UnreachableCodeJS
      yield "unreachable";
    } finally {
      errorBeforeFinalized.resolve();
    }
  }

  @HttpGet({ path: "error-after" })
  async *errorAfter() {
    try {
      yield "first";
      await new Promise<void>((resolve) => {
        releaseErrorAfterFirstChunk = resolve;
      });
      throw new Error("stream failed after the first chunk");
    } finally {
      errorAfterFinalized.resolve();
    }
  }

  @HttpGet({ path: "invalid-before" })
  async *invalidBefore() {
    yield 42;
  }

  @HttpGet({ path: "invalid-after" })
  async *invalidAfter() {
    yield "first";
    await new Promise<void>((resolve) => {
      releaseInvalidAfterFirstChunk = resolve;
    });
    yield 42;
  }

  @HttpGet({ path: "head-stream" })
  async *headStream() {
    noConsumeStreamStarted++;
    yield "not consumed";
  }

  @HttpGet({ path: "body-writer" })
  bodyWriter() {
    return new HttpResult(
      202,
      async (sink) => {
        bodyWriterStarted++;
        await sink.write("first ");
        await sink.write(Buffer.from("writer"));
      },
      { "content-type": "text/plain; charset=utf-8" },
    );
  }

  @HttpGet({ path: "body-writer-error-before" })
  bodyWriterErrorBefore() {
    return new HttpResult(200, async () => {
      throw new Error("body writer failed before writing");
    });
  }

  @HttpGet({ path: "body-writer-error-after" })
  bodyWriterErrorAfter() {
    return new HttpResult(200, async (sink) => {
      await sink.write("first");
      bodyWriterErrorAfterStarted.resolve();
      await new Promise<void>((resolve) => {
        releaseBodyWriterErrorAfter = resolve;
      });
      throw new Error("body writer failed after writing");
    });
  }

  @HttpGet({ path: "no-content-stream" })
  noContentStream() {
    return new HttpResult(204, this.noConsumeBody());
  }

  @HttpGet({ path: "not-modified-stream" })
  notModifiedStream() {
    return new HttpResult(304, this.noConsumeBody());
  }

  @HttpGet({ path: "backpressure" })
  async *backpressure() {
    backpressurePulls++;
    yield "first";
    backpressurePulls++;
    yield "tail";
  }

  private async *noConsumeBody() {
    noConsumeStreamStarted++;
    yield "not consumed";
  }
}

@HttpResource("state")
class StatefulResource {
  constructor(private count = 0) {}

  @HttpGet()
  get() {
    this.count++;
    return { count: this.count };
  }
}

async function setContextState(
  context: HttpContext,
  next: () => Promise<unknown>,
) {
  context.state.userId = context.req.headers["x-user-id"];
  return next();
}

@HttpMiddleware(setContextState)
@HttpResource("context-state")
class ContextStateResource {
  @HttpGet()
  get(context: HttpContext) {
    return { userId: context.state.userId };
  }
}

@HttpResource("api")
class TestApi {
  static readonly posts = new PostsResource();

  readonly state = new StatefulResource(99);
  readonly contextState = new ContextStateResource();

  @HttpResource()
  readonly users = new UsersResource();

  @HttpResource()
  readonly uploads = new UploadResource();
}

@OpenApiMiddleware({
  path: "/reference/openapi.json",
  info: { title: "Test API", version: "1.2.3" },
  servers: [{ url: "https://api.example.test" }],
  security: [{ bearerAuth: [] }],
  securitySchemes: {
    bearerAuth: { type: "http", scheme: "bearer" },
  },
})
@HttpResource()
class OpenApiTestApi {
  @HttpResource()
  readonly api = new TestApi();
}

@OpenApiMiddleware({
  path: "/api/posts/123",
  info: { title: "Test API", version: "1" },
})
@HttpResource()
class ConflictingOpenApiApi {
  @HttpResource()
  readonly api = new TestApi();
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

@OpenApiMiddleware({
  info: { title: "Middleware API", version: "1" },
})
@HttpMiddleware(rootMiddleware)
@HttpResource()
class OpenApiMiddlewareApi {
  @HttpGet({ path: "status", summary: "Get API status" })
  status() {
    return { online: true };
  }
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

@HttpResource("items")
@HttpMiddleware(sharedResourceMiddleware)
class MiddlewareItemsResource {
  @HttpGet({ path: ":id" })
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
  readonly items = new MiddlewareItemsResource();

  @HttpResource("other")
  readonly other = new OtherMiddlewareResource();
}

describe("HttpServer resource decorators", () => {
  const server = new HttpServer(TestApi);
  // noinspection DuplicatedCode
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

  it("creates a fresh instance of the matched resource for each request", async () => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/api/state`),
      fetch(`${baseUrl}/api/state`),
    ]);

    assert.deepEqual(
      await Promise.all(responses.map((response) => response.json())),
      [{ count: 1 }, { count: 1 }],
    );
  });

  it("shares request state between middleware and handlers without leaking it", async () => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/api/context-state`, {
        headers: { "x-user-id": "user-a" },
      }),
      fetch(`${baseUrl}/api/context-state`, {
        headers: { "x-user-id": "user-b" },
      }),
    ]);

    assert.deepEqual(
      await Promise.all(responses.map((response) => response.json())),
      [{ userId: "user-a" }, { userId: "user-b" }],
    );
  });

  it("validates request models and strips undeclared response fields", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "jane@example.com",
        name: "Jane",
        role: "admin",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      id: "u2",
      email: "jane@example.com",
      name: "Jane",
    });
  });

  it("returns a request-model instance from parseBody", async () => {
    const response = await fetch(`${baseUrl}/api/users/instance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "jane@example.com", name: "Jane" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { isInstance: true });
  });

  describe("OpenAPI middleware", () => {
    const openApiServer = new HttpServer(OpenApiTestApi);
    let openApiBaseUrl: string;

    before(async () => {
      const listeningServer = openApiServer.listen(0);
      await once(listeningServer, "listening");
      const address = listeningServer.address() as AddressInfo;
      openApiBaseUrl = `http://127.0.0.1:${address.port}`;
    });

    after(async () => {
      await openApiServer.close();
    });

    const fetchDocument = async () => {
      const response = await fetch(`${openApiBaseUrl}/reference/openapi.json`);
      assert.equal(response.status, 200);
      return {
        response,
        document: (await response.json()) as {
          openapi: string;
          info: { title: string; version: string };
          servers: Array<{ url: string }>;
          security: Array<Record<string, string[]>>;
          paths: Record<string, Record<string, Record<string, any>>>;
          components: {
            schemas: Record<string, Record<string, any>>;
            securitySchemes: Record<string, Record<string, string>>;
          };
        },
      };
    };

    it("generates document metadata and security configuration", async () => {
      const { response, document } = await fetchDocument();

      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/json/,
      );
      assert.equal(document.openapi, "3.1.0");
      assert.deepEqual(document.info, { title: "Test API", version: "1.2.3" });
      assert.deepEqual(document.servers, [{ url: "https://api.example.test" }]);
      assert.deepEqual(document.security, [{ bearerAuth: [] }]);
      assert.equal(
        document.components.securitySchemes.bearerAuth.scheme,
        "bearer",
      );
    });

    it("generates operations, parameters, and optional path variants", async () => {
      const { document } = await fetchDocument();

      assert.equal(
        document.paths["/api/posts/featured"].get.operationId,
        "getFeaturedPost",
      );
      assert.equal(document.paths["/api/posts/{id}"].get.summary, "Get a post");
      assert.equal(
        document.paths["/api/posts/{id}"].get.operationId,
        "getPost",
      );
      assert.deepEqual(document.paths["/api/posts/{id}"].get.tags, ["posts"]);
      assert.deepEqual(document.paths["/api/posts/{id}"].get.security, [
        { bearerAuth: [] },
      ]);
      assert.equal(document.paths["/api/posts"].get.operationId, undefined);
      assert.equal(document.paths["/api/users"].get.operationId, undefined);

      const parameters = document.paths["/api/posts/{id}"].get.parameters;
      assert.deepEqual(parameters[0], {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      });
      assert.equal(parameters[1].in, "query");
      assert.equal(parameters[2].in, "header");
      assert.equal(
        document.paths["/api/posts/optional"].get.operationId,
        "getOptionalPostWithoutId",
      );
      assert.equal(
        document.paths["/api/posts/optional/{id}"].get.operationId,
        "getOptionalPostWithId",
      );
    });

    it("generates request, response, validation, and model schemas", async () => {
      const { document } = await fetchDocument();

      assert.equal(
        document.paths["/api/posts/create"].post.responses["201"].description,
        "Post created",
      );
      assert.equal(
        document.paths["/api/posts/create"].post.responses["200"],
        undefined,
      );

      const createUser = document.paths["/api/users"].post;
      assert.equal(
        createUser.requestBody.content["application/json"].schema.$ref,
        "#/components/schemas/CreateUserModel",
      );
      assert.ok(createUser.responses["422"]);
      assert.ok(createUser.responses["409"]);
      assert.ok(createUser.responses["500"]);
      assert.equal(
        createUser.responses["200"].content["application/json"].schema.$ref,
        "#/components/schemas/UserResponseModel",
      );
      assert.deepEqual(
        document.paths["/api/users"].get.responses["200"].content[
          "application/json"
        ].schema,
        {
          type: "array",
          items: { $ref: "#/components/schemas/UserResponseModel" },
        },
      );

      const userSchema = document.components.schemas.CreateUserModel;
      assert.deepEqual(userSchema.required, ["email", "name"]);
      assert.equal(userSchema.properties.email.format, "email");
      assert.equal(userSchema.properties.externalId.format, "uuid");
      assert.deepEqual(userSchema.properties.optionalLabel, {
        default: null,
        anyOf: [{ type: "string" }, { type: "null" }],
      });
      assert.deepEqual(userSchema.properties.roles, {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      });
    });

    it("supports GET, HEAD, OPTIONS, rejects other methods, and falls through", async () => {
      const headResponse = await fetch(
        `${openApiBaseUrl}/reference/openapi.json`,
        { method: "HEAD" },
      );
      assert.equal(headResponse.status, 200);
      assert.equal(await headResponse.text(), "");

      const optionsResponse = await fetch(
        `${openApiBaseUrl}/reference/openapi.json`,
        { method: "OPTIONS" },
      );
      assert.equal(optionsResponse.status, 204);
      assert.equal(optionsResponse.headers.get("allow"), "GET, HEAD, OPTIONS");

      const unsupportedMethod = await fetch(
        `${openApiBaseUrl}/reference/openapi.json`,
        { method: "POST" },
      );
      assert.equal(unsupportedMethod.status, 405);
      assert.equal(
        unsupportedMethod.headers.get("allow"),
        "GET, HEAD, OPTIONS",
      );

      const unrelatedPath = await fetch(
        `${openApiBaseUrl}/reference/not-openapi.json`,
      );
      assert.equal(unrelatedPath.status, 404);
    });

    it("reuses the same generated document for every matching request", async () => {
      const middleware = createOpenApiRequestMiddleware([], {
        path: "/cached.json",
        info: { title: "Cached API", version: "1" },
      });
      const context = {
        req: { path: "/cached.json", method: "GET" },
      } as unknown as HttpContext;
      const unexpectedNext = async () => {
        throw new Error("The OpenAPI middleware should handle this path");
      };

      const first = await middleware(context, unexpectedNext);
      const second = await middleware(context, unexpectedNext);

      assert.strictEqual(first, second);
    });

    it("generates the document only when its endpoint is requested", async () => {
      const middleware = createOpenApiRequestMiddleware([], {
        path: "/lazy.json",
        info: { title: "", version: "1" },
      });
      const unrelatedContext = {
        req: { path: "/elsewhere", method: "GET" },
      } as unknown as HttpContext;
      const endpointContext = {
        req: { path: "/lazy.json", method: "GET" },
      } as unknown as HttpContext;

      assert.equal(
        await middleware(unrelatedContext, async () => "next"),
        "next",
      );
      assert.throws(
        () => middleware(endpointContext, async () => "unexpected next"),
        /OpenAPI info requires non-empty title and version/,
      );
    });

    it("rejects invalid endpoint paths", () => {
      assert.throws(
        () =>
          createOpenApiRequestMiddleware([], {
            path: "relative/openapi.json",
            info: { title: "Invalid API", version: "1" },
          }),
        /OpenAPI endpoint path must be an absolute URL path/,
      );
    });
  });

  it("returns structured validation issues for invalid request models", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", name: "J", extra: true }),
    });

    assert.equal(response.status, 422);
    const result = await response.json();
    assert.equal(result.message, "Request body failed model validation");
    assert.deepEqual(
      result.details.map((issue: { path: string }) => issue.path).sort(),
      ["email", "name"],
    );
  });

  it("returns a generic server error when a response violates its model", async () => {
    const response = await fetch(`${baseUrl}/api/users/invalid-response`);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      message: "Internal Server Error",
    });
  });

  it("does not validate a response body writer as a model value", async () => {
    const response = await fetch(`${baseUrl}/api/users/writer-response`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      id: 123,
      email: "not-an-email",
      name: "Invalid",
    });
  });

  it("validates each item in array response models", async () => {
    const response = await fetch(`${baseUrl}/api/users/invalid-response-array`);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      message: "Internal Server Error",
    });
  });

  it("rejects non-array values for array response models", async () => {
    const response = await fetch(`${baseUrl}/api/users/non-array-response`);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      message: "Internal Server Error",
    });
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
    assert.deepEqual(await response.json(), [
      { id: "u1", email: "user@example.test", name: "User" },
    ]);
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

  it("streams raw binary request bodies to a handler destination", async () => {
    const payload = Buffer.from([0x00, 0xff, 0x80, 0x41, 0x00, 0x7f]);
    const response = await fetch(`${baseUrl}/api/uploads/object-1/content`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: payload,
    });

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.id, "object-1");
    assert.equal(result.bytes, payload.byteLength);
    assert.ok(result.chunks > 0);
  });

  it("returns 413 when a declared raw upload exceeds its stream limit", async () => {
    const response = await fetch(`${baseUrl}/api/uploads/limited`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from("12345"),
    });

    assert.equal(response.status, 413);
    assert.equal(response.headers.get("connection"), "close");
    assert.deepEqual(await response.json(), {
      message: "Request body exceeds the maximum allowed size",
    });
  });

  it("enforces raw upload limits while receiving chunked bodies", async () => {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const outgoing = httpRequest(
        `${baseUrl}/api/uploads/limited`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            "transfer-encoding": "chunked",
          },
        },
        resolve,
      );
      outgoing.once("error", reject);
      outgoing.write("123");
      outgoing.end("456");
    });
    const chunks: Buffer[] = [];
    for await (const chunk of response) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    assert.equal(response.statusCode, 413);
    assert.equal(response.headers.connection, "close");
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
      message: "Request body exceeds the maximum allowed size",
    });
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

describe("HttpServer request body size limits", () => {
  const server = new HttpServer(RequestBodyLimitResource, {
    maxRequestBodyBytes: 4,
  });
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

  it("applies the server limit to buffered bodies despite a larger per-call limit", async () => {
    const response = await fetch(`${baseUrl}/buffered`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"x":1}',
    });

    assert.equal(response.status, 413);
  });

  it("allows an endpoint to raise the configured limit for buffered bodies", async () => {
    const response = await fetch(`${baseUrl}/buffered-raised`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"x":1}',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { x: 1 });
  });

  it("applies endpoint limits before root middleware consumes the body", async () => {
    const response = await fetch(`${baseUrl}/middleware-raised`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"x":1}',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { x: 1 });
  });

  it("applies endpoint overrides to automatically parsed model bodies", async () => {
    const response = await fetch(`${baseUrl}/modeled-raised`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "jane@example.com",
        name: "Jane",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { email: "jane@example.com" });
  });

  it("applies the server and endpoint limits to raw streamed bodies", async () => {
    const globalLimitResponse = await fetch(`${baseUrl}/streamed`, {
      method: "PUT",
      body: "12345",
    });
    const raisedLimitResponse = await fetch(`${baseUrl}/streamed-raised`, {
      method: "PUT",
      body: "12345",
    });
    const loweredLimitResponse = await fetch(`${baseUrl}/streamed-lowered`, {
      method: "PUT",
      body: "123",
    });

    assert.equal(globalLimitResponse.status, 413);
    assert.equal(raisedLimitResponse.status, 200);
    assert.deepEqual(await raisedLimitResponse.json(), { bytes: 5 });
    assert.equal(loweredLimitResponse.status, 413);
  });

  it("rejects invalid server request body limits", () => {
    assert.throws(
      () =>
        new HttpServer(RequestBodyLimitResource, { maxRequestBodyBytes: -1 }),
      RangeError,
    );
    assert.throws(
      () =>
        new HttpServer(RequestBodyLimitResource, {
          maxRequestBodyBytes: Number.POSITIVE_INFINITY,
        }),
      RangeError,
    );
    assert.throws(() => HttpPost({ maxRequestBodyBytes: -1 }), RangeError);
  });
});

describe("HttpServer.listen", () => {
  it("calls the callback once the server is listening", async () => {
    const server = new HttpServer(TestApi);
    let callbackCalled = false;

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          callbackCalled = true;
          resolve();
        });
      });

      assert.equal(callbackCalled, true);
    } finally {
      await server.close();
    }
  });
});

describe("HttpServer streaming behavior", () => {
  const server = new HttpServer(StreamingBehaviorResource);
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

  it("finalizes a generator when the client cancels after a chunk", async () => {
    canceledStreamFinalized = deferred();

    const response = await fetch(`${baseUrl}/cancel`);
    const reader = response.body!.getReader();
    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      "first",
    );

    await reader.cancel();
    releaseCanceledStream();
    await canceledStreamFinalized.promise;
  });

  it("finalizes a generator after disconnect while next() is pending", async () => {
    pendingStreamStarted = deferred();
    pendingStreamFinalized = deferred();
    const controller = new AbortController();
    const pendingResponse = fetch(`${baseUrl}/pending`, {
      signal: controller.signal,
    });
    void pendingResponse.catch(() => {});

    await pendingStreamStarted.promise;
    controller.abort();
    await assert.rejects(pendingResponse);

    releasePendingStream();
    await pendingStreamFinalized.promise;
  });

  it("returns a 500 when a generator errors before sending headers", async () => {
    errorBeforeFinalized = deferred();
    const response = await fetch(`${baseUrl}/error-before`);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      message: "Internal Server Error",
    });
    await errorBeforeFinalized.promise;
  });

  it("closes the connection when a generator errors after sending a chunk", async () => {
    errorAfterFinalized = deferred();
    const response = await fetch(`${baseUrl}/error-after`);
    const reader = response.body!.getReader();

    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      "first",
    );
    releaseErrorAfterFirstChunk();
    await assert.rejects(reader.read());
    await errorAfterFinalized.promise;
  });

  it("handles invalid chunks as errors before or after headers", async () => {
    const before = await fetch(`${baseUrl}/invalid-before`);
    assert.equal(before.status, 500);
    assert.deepEqual(await before.json(), {
      message: "Internal Server Error",
    });

    const after = await fetch(`${baseUrl}/invalid-after`);
    const reader = after.body!.getReader();
    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      "first",
    );
    releaseInvalidAfterFirstChunk();
    await assert.rejects(reader.read());
  });

  it("does not start async generators for HEAD, 204, or 304 responses", async () => {
    noConsumeStreamStarted = 0;

    const head = await fetch(`${baseUrl}/head-stream`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const noContent = await fetch(`${baseUrl}/no-content-stream`);
    assert.equal(noContent.status, 204);
    assert.equal(await noContent.text(), "");

    const notModified = await fetch(`${baseUrl}/not-modified-stream`);
    assert.equal(notModified.status, 304);
    assert.equal(await notModified.text(), "");
    assert.equal(noConsumeStreamStarted, 0);
  });

  it("awaits response body writers and skips them for HEAD requests", async () => {
    bodyWriterStarted = 0;

    const head = await fetch(`${baseUrl}/body-writer`, { method: "HEAD" });
    assert.equal(head.status, 202);
    assert.equal(head.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await head.text(), "");
    assert.equal(bodyWriterStarted, 0);

    const response = await fetch(`${baseUrl}/body-writer`);
    assert.equal(response.status, 202);
    assert.equal(await response.text(), "first writer");
    assert.equal(bodyWriterStarted, 1);
  });

  it("handles body writer errors before and after writing starts", async () => {
    const before = await fetch(`${baseUrl}/body-writer-error-before`);
    assert.equal(before.status, 500);
    assert.deepEqual(await before.json(), {
      message: "Internal Server Error",
    });
    assert.match(before.headers.get("content-type") ?? "", /application\/json/);

    bodyWriterErrorAfterStarted = deferred();
    const after = await fetch(`${baseUrl}/body-writer-error-after`);
    const reader = after.body!.getReader();
    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      "first",
    );

    await bodyWriterErrorAfterStarted.promise;
    releaseBodyWriterErrorAfter();
    await assert.rejects(reader.read());
  });

  it(
    "does not pull more chunks while the client is backpressured",
    { timeout: 5_000 },
    async () => {
      backpressurePulls = 0;
      let blockedResponse: ServerResponse | undefined;
      const writeBlocked = deferred<ServerResponse>();
      const originalWrite = ServerResponse.prototype.write;
      ServerResponse.prototype.write = function (
        chunk: any,
        encodingOrCallback?: any,
        callback?: any,
      ) {
        const result = originalWrite.call(
          this,
          chunk,
          encodingOrCallback,
          callback,
        );
        if (!blockedResponse) {
          blockedResponse = this;
          writeBlocked.resolve(this);
          return false;
        }
        return result;
      };

      let response: IncomingMessage | undefined;
      try {
        response = await new Promise<IncomingMessage>((resolve, reject) => {
          const request = httpGet(`${baseUrl}/backpressure`, (incoming) => {
            incoming.pause();
            resolve(incoming);
          });
          request.once("error", reject);
        });

        await writeBlocked.promise;
        assert.equal(backpressurePulls, 1);
        blockedResponse!.emit("drain");

        let receivedBytes = 0;
        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.byteLength;
        });
        response.resume();
        await once(response, "end");

        assert.equal(receivedBytes, Buffer.byteLength("firsttail"));
        assert.equal(backpressurePulls, 2);
      } finally {
        ServerResponse.prototype.write = originalWrite;
        response?.destroy();
      }
    },
  );

  it("suppresses rejected generator cleanup and closes cleanly after cancellation", async () => {
    cleanupErrorFinalized = deferred();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const response = await fetch(`${baseUrl}/cancel-cleanup-error`);
      const reader = response.body!.getReader();
      assert.equal(
        new TextDecoder().decode((await reader.read()).value),
        "first",
      );
      await reader.cancel();
      releaseCleanupError();
      await cleanupErrorFinalized.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandledRejections, []);
      await server.close();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});

let releaseSlowRequest!: () => void;
let notifySlowRequestStarted!: () => void;
const slowRequestStarted = new Promise<void>((resolve) => {
  notifySlowRequestStarted = resolve;
});

class LifecycleResource {
  @HttpGet({ path: "fail" })
  fail() {
    throw new Error("expected failure");
  }

  @HttpGet({ path: "slow" })
  async slow() {
    notifySlowRequestStarted();
    await new Promise<void>((resolve) => {
      releaseSlowRequest = resolve;
    });
    return new HttpResult(200, { completed: true }, { connection: "close" });
  }

  @HttpMethod("GET", { path: "ready" })
  ready() {
    return { ready: true };
  }
}

let notifyShutdownRequestStarted!: () => void;

class ShutdownTimeoutResource {
  @HttpGet()
  async hang() {
    notifyShutdownRequestStarted();
    await new Promise<void>(() => {});
  }
}

class ProxyUrlResource {
  @HttpGet()
  getUrl(context: HttpContext) {
    return { origin: context.req.url.origin };
  }
}

class InvalidOptionalParameterResource {
  @HttpGet({ path: ":id?/details" })
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

  it("accepts Node server options and closes cleanly with a timeout configured", async () => {
    const server = new HttpServer(LifecycleApi, {
      serverOptions: { headersTimeout: 2_000 },
    });
    const listeningServer = server.listen(0);
    assert.equal(listeningServer.headersTimeout, 2_000);
    await once(listeningServer, "listening");

    await server.close({ timeoutMs: 1_000 });
    assert.equal(listeningServer.listening, false);
  });

  it("force-closes remaining connections when the shutdown timeout expires", async () => {
    const started = new Promise<void>((resolve) => {
      notifyShutdownRequestStarted = resolve;
    });
    const server = new HttpServer(ShutdownTimeoutResource);
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    const pendingResponse = fetch(`http://127.0.0.1:${address.port}/`);
    await started;

    await server.close({ timeoutMs: 10 });
    await assert.rejects(pendingResponse);
  });

  it("rejects invalid graceful-shutdown timeouts", () => {
    const server = new HttpServer(LifecycleApi);
    assert.throws(() => server.close({ timeoutMs: -1 }), {
      name: "RangeError",
      message: "timeoutMs must be a non-negative finite number",
    });
  });
});

describe("HttpServer hooks", () => {
  it("allows custom error responses and reports request lifecycle metrics", async () => {
    const observedErrors: unknown[] = [];
    const observedResponses: Array<{ statusCode: number; completed: boolean }> =
      [];
    const server = new HttpServer(LifecycleApi, {
      onError: (error) => observedErrors.push(error),
      onResponse: (_context, metrics) => observedResponses.push(metrics),
      errorHandler: () =>
        new HttpResult(503, { message: "Service unavailable" }),
    });
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/fail`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        message: "Service unavailable",
      });
    } finally {
      await server.close();
    }

    assert.equal(observedErrors.length, 1);
    assert.equal((observedErrors[0] as Error).message, "expected failure");
    assert.ok(observedResponses.some((metrics) => metrics.statusCode === 503));
    assert.ok(observedResponses.every((metrics) => metrics.completed));
  });

  it("uses safe request IDs for response headers and lifecycle hooks", async () => {
    const observedIds: string[] = [];
    const server = new HttpServer(LifecycleApi, {
      onRequest: (context) => observedIds.push(context.requestId),
      onResponse: (context) => observedIds.push(context.requestId),
    });
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const suppliedIdResponse = await fetch(`${baseUrl}/`, {
        headers: { "x-request-id": "playground-test-42" },
      });
      assert.equal(
        suppliedIdResponse.headers.get("x-request-id"),
        "playground-test-42",
      );

      const unsafeIdResponse = await fetch(`${baseUrl}/`, {
        headers: { "x-request-id": "unsafe id" },
      });
      const generatedId = unsafeIdResponse.headers.get("x-request-id");
      assert.match(generatedId ?? "", /^[0-9a-f-]{36}$/i);
    } finally {
      await server.close();
    }

    assert.deepEqual(observedIds.slice(0, 2), [
      "playground-test-42",
      "playground-test-42",
    ]);
    assert.equal(observedIds.length, 4);
    assert.equal(observedIds[2], observedIds[3]);
  });

  it("can disable request ID generation and headers", async () => {
    const observedIds: Array<string | undefined> = [];
    const server = new HttpServer(LifecycleApi, {
      requestId: false,
      onRequest: (context) => observedIds.push(context.requestId),
      onResponse: (context) => observedIds.push(context.requestId),
    });
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/ready`, {
        headers: { "x-request-id": "client-supplied-id" },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.has("x-request-id"), false);
    } finally {
      await server.close();
    }

    assert.deepEqual(observedIds, [undefined, undefined]);
  });
});

describe("HttpServer route validation", () => {
  it("rejects optional parameters that are not the final path segment", () => {
    assert.throws(() => new HttpServer(InvalidOptionalParameterResource), {
      name: "TypeError",
      message: "Optional route parameters must be the final path segment",
    });
  });

  it("lets OpenAPI middleware take over a matching application path", async () => {
    const openApiServer = new HttpServer(ConflictingOpenApiApi);
    const listeningServer = openApiServer.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/posts/123`,
      );
      const document = (await response.json()) as {
        info: { title: string; version: string };
      };

      assert.equal(response.status, 200);
      assert.deepEqual(document.info, { title: "Test API", version: "1" });
    } finally {
      await openApiServer.close();
    }
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

  it("runs root middleware for the generated OpenAPI endpoint", async () => {
    const docsServer = new HttpServer(OpenApiMiddlewareApi);
    const listeningServer = docsServer.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    middlewareTrace.length = 0;

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/openapi.json`,
      );

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-root-middleware"), "ran");
      const document = (await response.json()) as {
        openapi: string;
        paths: Record<string, Record<string, { summary?: string }>>;
      };
      assert.equal(document.openapi, "3.1.0");
      assert.equal(document.paths["/status"].get.summary, "Get API status");
      assert.deepEqual(middlewareTrace, ["root:before", "root:after"]);
    } finally {
      await docsServer.close();
    }
  });
});
