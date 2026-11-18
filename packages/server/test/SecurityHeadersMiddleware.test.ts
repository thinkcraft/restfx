import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  HttpGet,
  HttpResource,
  HttpServer,
  SecurityHeadersMiddleware,
} from "../src/index.js";

@SecurityHeadersMiddleware()
@HttpResource("security-headers")
class DefaultSecurityHeadersResource {
  @HttpGet()
  get() {
    return { ok: true };
  }
}

@SecurityHeadersMiddleware({
  headers: {
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": false,
    "Content-Security-Policy": "default-src 'self'",
  },
})
@HttpResource("custom-security-headers")
class CustomSecurityHeadersResource {
  @HttpGet()
  get() {
    return { ok: true };
  }
}

const defaultServer = new HttpServer(DefaultSecurityHeadersResource);
const customServer = new HttpServer(CustomSecurityHeadersResource);
let defaultBaseUrl: string;
let customBaseUrl: string;

before(async () => {
  const defaultListeningServer = defaultServer.listen(0);
  const customListeningServer = customServer.listen(0);
  await Promise.all([
    once(defaultListeningServer, "listening"),
    once(customListeningServer, "listening"),
  ]);
  defaultBaseUrl = `http://127.0.0.1:${(defaultListeningServer.address() as AddressInfo).port}`;
  customBaseUrl = `http://127.0.0.1:${(customListeningServer.address() as AddressInfo).port}`;
});

after(async () => {
  await Promise.all([defaultServer.close(), customServer.close()]);
});

describe("SecurityHeadersMiddleware", () => {
  it("sets default headers on resource responses", async () => {
    const response = await fetch(`${defaultBaseUrl}/security-headers`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(
      response.headers.get("referrer-policy"),
      "strict-origin-when-cross-origin",
    );
    assert.equal(response.headers.get("content-security-policy"), null);
    assert.equal(response.headers.get("strict-transport-security"), null);
  });

  it("allows overriding and disabling default headers", async () => {
    const response = await fetch(`${customBaseUrl}/custom-security-headers`);

    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(response.headers.get("referrer-policy"), null);
    assert.equal(
      response.headers.get("content-security-policy"),
      "default-src 'self'",
    );
  });

  it("validates header names and values at decoration time", () => {
    assert.throws(
      () => SecurityHeadersMiddleware({ headers: { "bad header": "value" } }),
      /header name/,
    );
    assert.throws(
      () =>
        SecurityHeadersMiddleware({
          headers: { "X-Test": "safe\r\nInjected: yes" },
        }),
      /header: X-Test/,
    );
  });
});
