import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  CorsMiddleware,
  HttpContext,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpServer,
} from "../src/index.js";

@CorsMiddleware({
  origins: ["*.example.com"],
  credentials: true,
  allowedHeaders: ["content-type", "x-request-id"],
  exposedHeaders: ["x-total-count"],
  maxAge: 600,
})
@HttpResource("cors")
class CorsResource {
  @HttpGet()
  get(context: HttpContext) {
    context.res.setHeader("x-total-count", "1");
    return { ok: true };
  }

  @HttpPost()
  post() {
    return { ok: true };
  }
}

@CorsMiddleware({ origins: ["https://*.secure.example.com"] })
@HttpResource("secure-cors")
class SecureCorsResource {
  @HttpGet()
  get() {
    return { ok: true };
  }
}

const server = new HttpServer(CorsResource);
const secureServer = new HttpServer(SecureCorsResource);
let baseUrl: string;
let secureBaseUrl: string;

before(async () => {
  const listeningServer = server.listen(0);
  const listeningSecureServer = secureServer.listen(0);
  await Promise.all([
    once(listeningServer, "listening"),
    once(listeningSecureServer, "listening"),
  ]);
  baseUrl = `http://127.0.0.1:${(listeningServer.address() as AddressInfo).port}`;
  secureBaseUrl = `http://127.0.0.1:${(listeningSecureServer.address() as AddressInfo).port}`;
});

after(async () => {
  await Promise.all([server.close(), secureServer.close()]);
});

describe("CorsMiddleware", () => {
  it("echoes an allowed wildcard subdomain origin on actual responses", async () => {
    const response = await fetch(`${baseUrl}/cors`, {
      headers: { origin: "https://app.example.com" },
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://app.example.com",
    );
    assert.equal(
      response.headers.get("access-control-allow-credentials"),
      "true",
    );
    assert.equal(
      response.headers.get("access-control-expose-headers"),
      "x-total-count",
    );
    assert.match(response.headers.get("vary") ?? "", /Origin/i);
  });

  it("does not allow the apex domain or a suffix-confusion hostname", async () => {
    for (const origin of ["https://example.com", "https://notexample.com"]) {
      const response = await fetch(`${baseUrl}/cors`, { headers: { origin } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.match(response.headers.get("vary") ?? "", /Origin/i);
    }
  });

  it("answers valid preflights and advertises the resource's methods", async () => {
    const response = await fetch(`${baseUrl}/cors`, {
      method: "OPTIONS",
      headers: {
        origin: "https://admin.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, x-request-id",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://admin.example.com",
    );
    assert.match(
      response.headers.get("access-control-allow-methods") ?? "",
      /POST/,
    );
    assert.equal(
      response.headers.get("access-control-allow-headers"),
      "content-type, x-request-id",
    );
    assert.equal(response.headers.get("access-control-max-age"), "600");
    assert.match(
      response.headers.get("vary") ?? "",
      /Access-Control-Request-Method/i,
    );
  });

  it("rejects preflights for disallowed methods and headers", async () => {
    const methodResponse = await fetch(`${baseUrl}/cors`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "DELETE",
      },
    });
    assert.equal(methodResponse.status, 403);

    const headerResponse = await fetch(`${baseUrl}/cors`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization",
      },
    });
    assert.equal(headerResponse.status, 403);
  });

  it("supports scheme-specific wildcard origins", async () => {
    for (const [origin, allowed] of [
      ["https://api.secure.example.com", true],
      ["http://api.secure.example.com", false],
      ["https://secure.example.com", false],
    ] as const) {
      const response = await fetch(`${secureBaseUrl}/secure-cors`, {
        headers: { origin },
      });
      assert.equal(
        response.headers.get("access-control-allow-origin") !== null,
        allowed,
      );
    }
  });

  it("validates configured origin patterns and options", () => {
    assert.throws(
      () => CorsMiddleware({ origins: ["https://example.com/path"] }),
      /Invalid CORS origin/,
    );
    assert.throws(
      () => CorsMiddleware({ origins: ["https://*example.com"] }),
      /Invalid CORS origin pattern/,
    );
    assert.throws(
      () => CorsMiddleware({ origins: ["https://example.com"], maxAge: -1 }),
      /maxAge/,
    );
  });
});
