---
title: RestFX documentation
description: Build TypeScript HTTP APIs with shared models, runtime validation, and typed clients.
template: splash
hero:
  title: Build APIs with RestFX
  tagline: Share runtime-validated models between your TypeScript server and client.
  actions:
    - text: Get started
      link: getting-started/
      icon: right-arrow
    - text: GitHub repository
      link: https://github.com/thinkcraft/restfx
      icon: external
---

RestFX is a TypeScript-first framework for building HTTP APIs. Its packages keep
shared models browser-safe while separating Node.js server behavior from Fetch
clients.

## The packages

- **[`@restfx/core`](./models/)** — shared models, field types, runtime
  validation, and typed configuration.
- **[`@restfx/server`](./server/)** — a Node.js HTTP server with decorated
  resources, middleware, request parsing, and OpenAPI generation.
- **[`@restfx/client`](./client/)** — a Fetch wrapper and a generator for typed
  clients from OpenAPI documents.

## Guides

- [Get started](./getting-started/) with the packages and a small API.
- [Define and validate models](./models/) shared across the server and client.
- [Build an HTTP server](./server/) from nested resources and handlers.
- [Inject services](./dependency-injection/) with singleton or request lifetimes.
- [Add middleware](./middleware/) for cross-cutting behavior, CORS, and security headers.
- [Handle requests](./request-handling/) including bodies, cookies, and streams.
- [Generate OpenAPI](./openapi/) and serve an interactive API reference.
- [Call your API](./client/) with Fetch or generate a typed client.
- [Operate the server](./operations/) with lifecycle hooks and proxy settings.

For a complete example, see the [playground](https://github.com/thinkcraft/restfx/tree/main/apps/playground)
and the package READMEs in the [repository](https://github.com/thinkcraft/restfx).
