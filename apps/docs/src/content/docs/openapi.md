---
title: OpenAPI
description: Generate an OpenAPI 3.1 document and optional interactive reference UI.
---

`@restfx/server` generates an OpenAPI 3.1 document from registered routes,
decorator options, and `@restfx/core` model metadata. Add
`@OpenApiMiddleware(options)` to the root resource:

```ts
import { HttpResource, OpenApiMiddleware } from "@restfx/server";

@OpenApiMiddleware({
  path: "/openapi.json",
  info: {
    title: "Example API",
    version: "1.0.0",
    description: "Example service",
  },
  servers: [{ url: "https://api.example.com" }],
  securitySchemes: {
    bearerAuth: { type: "http", scheme: "bearer" },
  },
  security: [{ bearerAuth: [] }],
})
@HttpResource()
class ApiResource {
  // Mount route resources here.
}
```

The endpoint defaults to `/openapi.json`, serves `GET` and `HEAD`, answers
`OPTIONS`, and returns `405` for other methods. The document is generated on
the first `GET` or `HEAD` and cached. Root middleware runs before the
OpenAPI response. The configured path must be an absolute URL path and must not
overlap an application route.

## Add operation metadata

HTTP method decorators accept OpenAPI operation fields such as `summary`,
`description`, `operationId`, `tags`, `deprecated`, `parameters`, and `security`.
They also accept `requestBody`, `responses`, and the model shortcuts `body`,
`request`, and `response`:

```ts
@HttpGet({
  path: ":id",
  summary: "Get a user",
  operationId: "getUser",
  tags: ["users"],
  parameters: [
    { name: "include", in: "query", schema: { type: "boolean" } },
  ],
  responses: { "404": { description: "User not found" } },
})
getUser() {
  // ...
}
```

Use `@HttpResource({ path, tag, description })` to add a resource prefix and
describe its OpenAPI tag. Use `@Model({ description })` for model descriptions.
Operation IDs must be unique. By default, the method name is used when unique;
set `operationId` explicitly when method names are repeated or route variants
need stable names. Optional final route parameters generate both path variants.

Routes contribute methods and paths, inferred path parameters, model schemas,
and standard request-validation responses. Built-in types and field constraints
map to JSON Schema; semantic types like `UUID` and `Email` also emit their
formats. For non-model response bodies, document the response schema and content
type in `responses`. A custom field's `schema` metadata enriches the generated
schema but does not perform runtime validation.

## Serve a reference UI

Set `ui` to expose an interactive explorer alongside the JSON document:

```ts
@OpenApiMiddleware({
  path: "/openapi.json",
  ui: { type: "scalar", path: "/docs" },
  info: { title: "Example API", version: "1.0.0" },
})
@HttpResource()
class ApiResource {}
```

Choose `type: "scalar"`, `"swagger"`, or `"redoc"`; the UI path defaults to
`/docs` and must differ from the document path. The UI HTML loads its UI bundle
from a third-party CDN (Scalar from jsDelivr, Swagger UI from unpkg, or Redoc
from cdn.redoc.ly). Consider the external network and Content Security Policy
implications for your deployment. Omit `ui` to serve only the JSON document.

OpenAPI generation describes the HTTP contract; it does not replace runtime
validation or authentication. Security schemes and operation security describe
the contract only; they do not authenticate requests. See [model validation](./models/) and
[request handling](./request-handling/) for runtime behavior. The client
generator consumes this document; see [typed clients](./client/).
