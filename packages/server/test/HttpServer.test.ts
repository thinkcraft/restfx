import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  HttpContext,
  HttpDelete,
  HttpGet,
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

  @HttpPost("create")
  create() {
    return new HttpResult(201, { id: 2 });
  }

  @HttpDelete()
  remove() {
    return new HttpResult(204);
  }
}

class CommentsResource {
  @HttpGet()
  list() {
    return [{ id: "c1" }];
  }
}

@HttpResource("api")
class TestApi {
  @HttpResource()
  static readonly posts = new PostsResource();

  @HttpResource()
  readonly comments = new CommentsResource();
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

  it("registers instance resource fields", async () => {
    const response = await fetch(`${baseUrl}/api/comments`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ id: "c1" }]);
  });

  it("supports handler paths and HttpResult status codes", async () => {
    const response = await fetch(`${baseUrl}/api/posts/create`, {
      method: "POST",
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 2 });
  });

  it("matches and exposes named path parameters", async () => {
    const response = await fetch(`${baseUrl}/api/posts/42`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: "42" });
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
