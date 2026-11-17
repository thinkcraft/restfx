---
title: Server operations
description: Configure error handling, observability hooks, proxy trust, and shutdown.
---

`HttpServer` wraps Node's `node:http` server and accepts framework options as
its second constructor argument. It can be used alongside Node HTTP server
configuration without moving transport-specific code into `@restfx/core`.

## Errors and observability

By default, `HttpError` responses preserve their status and details, while
unexpected errors produce a generic `500`. Set `errorHandler` to customize the
response. `onRequest`, `onError`, and `onResponse` hooks are useful for logging
and metrics; hook failures are isolated so they do not change request behavior:

```ts
const server = new HttpServer(ApiResource, {
  onError(error, context) {
    logger.error({ error, requestId: context?.requestId });
  },
  onResponse(context, metrics) {
    logger.info({
      requestId: context.requestId,
      path: context.req.path,
      statusCode: metrics.statusCode,
      durationMs: metrics.durationMs,
      completed: metrics.completed,
    });
  },
  errorHandler(error) {
    if (error instanceof HttpError && error.status === 404) {
      return new HttpResult(404, { message: "Not found" });
    }
    return new HttpResult(500, { message: "Request failed" });
  },
});
```

`errorHandler` is not called after response headers have been sent. Streaming
errors after data has started close the connection because a replacement error
response is no longer possible. `onResponse` reports status, duration, and
whether the response completed.

Each request gets a `context.requestId`. A valid incoming `X-Request-Id` token
(1–128 characters) is retained; otherwise the server creates a UUID. The ID is
returned in the response header and is available to hooks. Treat a client
supplied ID as a correlation value, never as identity or authorization data.

## Node server options and lifecycle

Pass `serverOptions` through to Node's `http.createServer()` (for example,
`headersTimeout` and `requestTimeout`). `listen(port = 3000)` returns the Node
`Server` instance. `await server.close()` stops accepting connections and waits
for active requests; `close({ timeoutMs })` force-closes remaining connections
after the timeout. Closing before listening is safe.

## Reverse proxies

Forwarded headers are ignored unless the connecting peer is trusted. Configure
`trustProxy` as a predicate over the remote socket address, and trust only the
addresses of your actual proxy:

```ts
const server = new HttpServer(ApiResource, {
  trustProxy: (remoteAddress) =>
    remoteAddress === "10.0.0.10" || remoteAddress === "::ffff:10.0.0.10",
});
```

For a trusted peer, the server uses validated singular `X-Forwarded-Host` and
`X-Forwarded-Proto` values (`http` or `https`). Configure proxies to overwrite
or sanitize forwarded headers. Do not trust arbitrary clients or broad address
ranges without an explicit network boundary.

## Configuration and examples

Core's `defineConfig()` is a typed helper for application configuration, not an
environment loader. Read environment variables and validate deployment
settings in your application, then pass the chosen port and server options to
`HttpServer`. The [playground](https://github.com/thinkcraft/restfx/tree/main/apps/playground)
shows this with structured logging and an injected service container.
