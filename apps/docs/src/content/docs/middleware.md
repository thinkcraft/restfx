---
title: Middleware and CORS
description: Apply request middleware to resources and configure cross-origin access.
---

`@HttpMiddleware(handler)` attaches middleware to a resource and its nested
resources. Middleware runs in order from ancestor to child and can continue the
chain, short-circuit it, or wrap the downstream result.

## Write middleware

Middleware receives an `HttpContext` and an async `next` function. Use
`context.state` to share request-local data with later middleware or the
handler:

```ts
import {
  HttpContext,
  HttpGet,
  HttpMiddleware,
  HttpResource,
  HttpResult,
} from "@restfx/server";

async function requireToken(
  context: HttpContext,
  next: () => Promise<unknown>,
) {
  if (!context.req.headers.authorization) {
    return new HttpResult(401, { message: "Unauthorized" });
  }
  return next();
}

@HttpMiddleware(requireToken)
@HttpResource("private")
class PrivateResource {
  @HttpGet()
  getSecret() {
    return { secret: "available to authenticated callers" };
  }
}
```

Middleware can set response headers with `context.res.setHeader()`. The
request's `context.state` starts empty for each request; applications can
augment the exported `HttpContextState` interface to type custom properties.
Middleware exceptions follow the same server error handling as handler
exceptions.

## Configure CORS

Apply `@CorsMiddleware(options)` to the root resource to handle CORS headers and
preflight requests:

```ts
import { CorsMiddleware, HttpResource } from "@restfx/server";

@CorsMiddleware({
  origins: ["https://app.example.com", "*.preview.example.com"],
  credentials: true,
  allowedHeaders: ["content-type", "authorization"],
  exposedHeaders: ["x-total-count"],
  maxAge: 600,
})
@HttpResource()
class ApiResource {
  // Mount resources here.
}
```

`origins` accepts exact HTTP(S) origins and host patterns. A host-only wildcard
matches subdomains at any depth but not the apex domain, and allows either
scheme and any port. For example, `https://*.preview.example.com` restricts the
scheme; including a port restricts that too. Matching origins are echoed in
`Access-Control-Allow-Origin`, so credentialed requests work with an explicit
allowlist rather than `*`. Non-matching origins receive no CORS allow headers.

Preflight methods default to methods registered on the resource, including
implicit `HEAD` and `OPTIONS`; `methods` can override that list. If
`allowedHeaders` is omitted, requested preflight headers are reflected. The
middleware adds relevant `Vary` headers. CORS is a browser access policy, not an
authentication or authorization mechanism.

For cookie-based browser calls, pair `credentials: "include"` in the client
with `credentials: true` and an explicit allowed origin on the server. Browser
cookie `SameSite`, `Secure`, and domain rules still apply.
