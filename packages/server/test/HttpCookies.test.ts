import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  HttpContext,
  HttpGet,
  HttpResource,
  HttpServer,
} from "../src/index.js";

@HttpResource("cookies")
class CookiesResource {
  @HttpGet({ path: "read" })
  read(context: HttpContext) {
    return {
      value: context.cookies.get("value"),
      repeated: context.cookies.getAll("repeated"),
      plus: context.cookies.get("plus"),
    };
  }

  @HttpGet({ path: "ambiguous" })
  ambiguous(context: HttpContext) {
    return { value: context.cookies.get("repeated") };
  }

  @HttpGet({ path: "write" })
  write(context: HttpContext) {
    context.res.setHeader("set-cookie", "existing=preserved");
    context.cookies.set("session", "hello world", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    context.cookies.clear("old", { path: "/account", domain: "example.com" });
    return { ok: true };
  }
}

const server = new HttpServer(CookiesResource);
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

describe("HttpCookies", () => {
  it("reads and decodes request cookies while preserving repeated values", async () => {
    const response = await fetch(`${baseUrl}/cookies/read`, {
      headers: {
        cookie: "value=hello%20world; repeated=one; repeated=two; plus=a+b",
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      value: "hello world",
      repeated: ["one", "two"],
      plus: "a+b",
    });
  });

  it("rejects ambiguous single-cookie reads and malformed encoded values", async () => {
    const duplicate = await fetch(`${baseUrl}/cookies/ambiguous`, {
      headers: { cookie: "repeated=one; repeated=two" },
    });
    assert.equal(duplicate.status, 400);

    const malformed = await fetch(`${baseUrl}/cookies/read`, {
      headers: { cookie: "value=%E0%A4%A" },
    });
    assert.equal(malformed.status, 400);
  });

  it("appends Set-Cookie headers and clears cookies with the given scope", async () => {
    const response = await fetch(`${baseUrl}/cookies/write`);

    assert.deepEqual(response.headers.getSetCookie(), [
      "existing=preserved",
      "session=hello%20world; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
      "old=; Path=/account; Domain=example.com; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
  });
});
