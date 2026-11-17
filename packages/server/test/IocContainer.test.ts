import assert from "node:assert/strict";
import { get as httpGet } from "node:http";
import { describe, it } from "node:test";
import {
  IocContainer,
  HttpContext,
  HttpGet,
  HttpMiddleware,
  HttpResource,
  HttpServer,
  Inject,
} from "../src/index.js";

describe("IocContainer", () => {
  it("shares singleton services and isolates request-scoped services", () => {
    const container = new IocContainer();
    const singleton = { value: "shared" };
    const functionService = () => "service function";
    container
      .registerSingleton("singleton", singleton)
      .registerInstance("function-service", functionService);
    container.registerRequest("request", () => ({}));

    const firstRequest = container.createRequestScope();
    const secondRequest = container.createRequestScope();

    assert.equal(firstRequest.get("singleton"), singleton);
    assert.equal(secondRequest.get("singleton"), singleton);
    assert.equal(firstRequest.get("function-service"), functionService);
    assert.equal(firstRequest.get("request"), firstRequest.get("request"));
    assert.notEqual(firstRequest.get("request"), secondRequest.get("request"));
    assert.throws(() => container.get("request"), /request context/);
  });

  it("resolves unregistered class tokens with request lifetime", () => {
    class Service {}
    const firstRequest = new IocContainer().createRequestScope();

    assert.equal(firstRequest.get(Service), firstRequest.get(Service));
    assert.notEqual(
      firstRequest.get(Service),
      new IocContainer().createRequestScope().get(Service),
    );
  });

  it("exposes a request scope on context and injects resource properties", async () => {
    let nextId = 0;
    class RequestValue {
      readonly id = String(nextId++);
    }

    const container = new IocContainer();
    container.registerRequest("request-value", () => new RequestValue());

    class BaseResource {
      @Inject("request-value")
      value!: RequestValue;
    }

    @HttpMiddleware(async function (
      this: BaseResource,
      context: HttpContext,
      next: () => Promise<unknown>,
    ) {
      context.res.setHeader(
        "x-injected-middleware",
        String(
          this.value === context.container.get<RequestValue>("request-value"),
        ),
      );
      return next();
    })
    @HttpResource()
    class Resource extends BaseResource {
      @Inject(RequestValue)
      typedValue!: RequestValue;

      @HttpGet()
      get(context: HttpContext) {
        return {
          injected:
            this.value === context.container.get<RequestValue>("request-value"),
          typed: this.typedValue instanceof RequestValue,
          id: this.value.id,
        };
      }
    }

    const server = new HttpServer(Resource, { container });
    const listeningServer = server.listen(0);
    const address = listeningServer.address();
    assert.ok(address && typeof address !== "string");

    try {
      const get = () =>
        new Promise<{
          injected: boolean;
          typed: boolean;
          id: string;
          middlewareInjected: boolean;
        }>((resolve, reject) => {
          const request = httpGet(
            `http://127.0.0.1:${address.port}/`,
            (response) => {
              let body = "";
              response.setEncoding("utf8");
              response.on("data", (chunk: string) => (body += chunk));
              response.on("end", () =>
                resolve({
                  ...JSON.parse(body),
                  middlewareInjected:
                    response.headers["x-injected-middleware"] === "true",
                }),
              );
            },
          );
          request.on("error", reject);
        });
      const [first, second] = await Promise.all([get(), get()]);
      assert.equal(first.injected, true);
      assert.equal(first.typed, true);
      assert.equal(first.middlewareInjected, true);
      assert.equal(second.injected, true);
      assert.equal(second.typed, true);
      assert.equal(second.middlewareInjected, true);
      assert.notEqual(first.id, second.id);
    } finally {
      await server.close();
    }
  });
});
