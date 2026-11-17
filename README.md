# RestFX

RestFX is a TypeScript-first framework for building HTTP APIs with shared,
runtime-validated models, a Node.js server, and typed browser clients. The pnpm
workspace keeps the shared model layer browser-safe and separates server and
client runtime concerns into their own packages.

## Requirements

- Node.js 24 or newer
- pnpm 11

## Workspace packages

- `packages/core` (`@restfx/core`) — shared models, field validation,
  enum field types, and typed framework configuration via `defineConfig`.
- `packages/client` (`@restfx/client`) — a small configurable fetch client.
- `packages/server` (`@restfx/server`) — Node.js HTTP server, decorated
  resources, middleware, routing, and request-body parsing. See the
  [server README](packages/server/README.md) for usage and behavior.
- `apps/playground` — runnable example application.
- `apps/docs` — Astro Starlight documentation site.

## Framework features

- **Shared TypeScript models** — Stage 3 `@Model` and `@Field` decorators,
  built-in string, number, integer, boolean, email, UUID, date/time, enum,
  array, union, and discriminated-union field types; optional, nullable, default,
  and constraint metadata; nested models, inheritance, unknown-field policies,
  and cross-field validation.
- **Runtime validation and schema alignment** — validate input into model
  instances without invoking constructors, report field-path issues, and use
  the same model metadata to generate OpenAPI schemas and typed client models.
- **Decorator-based HTTP resources and routing** — compose nested resources,
  register handlers for standard HTTP methods, and route static, named,
  optional, and trailing-wildcard path segments. Includes `HEAD` fallback,
  automatic `OPTIONS`, and `405` responses with `Allow` headers.
- **Request and response handling** — bounded parsing for JSON, URL-encoded,
  multipart, and binary bodies; validated request and response models; combined
  models sourced from path, query, header, and body; configurable status,
  headers, and body results; and backpressure-aware streaming uploads and
  responses.
- **Middleware and services** — resource-scoped middleware with short-circuiting,
  configurable CORS, and dependency injection with singleton and request
  lifetimes.
- **HTTP utilities and lifecycle controls** — cookie read/write helpers,
  request-scoped state and cancellation, request-ID correlation, lifecycle and
  error hooks, configurable Node HTTP server options, graceful shutdown, and
  opt-in trusted-proxy handling.
- **OpenAPI documentation** — generate an OpenAPI document from routes, request
  and response models, and field metadata; configure operation details and
  security schemes; optionally serve Scalar, Swagger UI, or Redoc CE.
- **Fetch client and client generation** — use a lightweight configurable
  Fetch wrapper or generate typed operation methods from OpenAPI. Generated
  methods support model validation, path/query/header parameters, JSON,
  multipart, URL-encoded, text, and binary bodies, plus structured HTTP errors.

See the package guides below for the exact APIs, supported behavior, and examples.

## Guides

- [Documentation site](https://thinkcraft.github.io/restfx/) — guides and API
  reference. See the [docs app README](apps/docs/README.md) to run and build the
  Starlight site locally.
- [Core models and validation](packages/core/README.md) — define shared models,
  field constraints, nested models, and cross-field validation.
- [HTTP server](packages/server/README.md) — routes, middleware, request
  parsing, dependency injection, OpenAPI, and lifecycle behavior.
- [Client and API generator](packages/client/README.md) — issue fetch requests
  or generate a typed client from an OpenAPI document.
- [Releasing packages](RELEASING.md) — configure npm trusted publishing and
  publish versioned releases with GitHub Actions.

For a working example, start with the playground below, then browse
`apps/playground/src` for the resource, model, and injected-service layout.

## Getting started

```sh
pnpm install
pnpm dev
```

The playground listens on <http://localhost:3000>. Set `PORT` to change the
port. It is an example application, not a production server template: use its
models and resource structure as a starting point, and configure application
security, persistence, and deployment-specific limits for your own service.

Open the interactive Swagger UI reference at <http://localhost:3000/docs>; the raw
OpenAPI document is at <http://localhost:3000/openapi.json>. The sample API
models a workspace with nested projects and tasks, including validated request
bodies, query filters, and CRUD-style operations. Its seeded workspace ID is
`550e8400-e29b-41d4-a716-446655440000`; for example:

```sh
curl "http://localhost:3000/workspaces/550e8400-e29b-41d4-a716-446655440000/projects?status=active&limit=10"
```

The playground also includes a demo cookie session and binary attachment API.
The demo credentials are `demo@example.test` / `playground-only`; they are
hard-coded examples, not production authentication. Successful login returns
an HttpOnly session cookie, which you can reuse for the current-session and
logout endpoints:

```sh
curl -i -c cookies.txt -H 'content-type: application/json' \
  -d '{"email":"demo@example.test","password":"playground-only"}' \
  http://localhost:3000/auth/session
curl -b cookies.txt http://localhost:3000/auth/session
curl -i -b cookies.txt -X DELETE http://localhost:3000/auth/session
```

Upload and download one raw binary attachment at a time. This example keeps
attachments in memory and limits uploads to 5 MiB; use streaming and durable
storage for larger or production uploads:

```sh
curl -X PUT -H 'content-type: application/octet-stream' \
  --data-binary @./attachment.bin \
  http://localhost:3000/attachments/example-file
curl -o downloaded.bin http://localhost:3000/attachments/example-file
```

The playground includes an end-to-end test that runs its generated client
against the in-process HTTP server and checks the OpenAPI document, successful
operations, duplicate conflicts, and request validation. `pnpm test` runs this
alongside the package tests. The server's request lifecycle hooks and
`X-Request-Id` correlation behavior are demonstrated in the playground's
colorized Pino logs.

To explore the packages independently, run a package's test suite:

```sh
pnpm --filter @restfx/core test
pnpm --filter @restfx/server test
pnpm --filter @restfx/client test
```

The package guides describe each package's runtime boundary and examples.

Use `Enum` for fields whose values are restricted to a fixed set. It infers the
literal union, validates values at runtime, and generates the corresponding
OpenAPI enum schema:

```ts
import { Enum, Field, Model } from "@restfx/core";

@Model({ description: "A project and its current lifecycle state." })
class Project {
  @Field({ type: Enum(["active", "archived"]) })
  status!: "active" | "archived";
}
```

Shared models also support ISO/RFC 3339 `DateField`, `TimeField`, and
`DateTimeField` values (kept as strings), `UnionOf(...)` for alternative field
types, and `DiscriminatedUnion(...)` for unions of decorated models. OpenAPI
preserves these as `date`, `time`, and `date-time` formats, `anyOf`, and
`oneOf` schemas with discriminator mappings; generated client types retain the
union alternatives.

```ts
import {
  DateField,
  DiscriminatedUnion,
  Enum,
  Field,
  Model,
  NumberField,
  StringField,
  UnionOf,
} from "@restfx/core";

@Model()
class Cat {
  @Field({ type: Enum(["cat"]) })
  kind!: "cat";

  @Field({ type: StringField })
  name!: string;
}

@Model()
class Dog {
  @Field({ type: Enum(["dog"]) })
  kind!: "dog";

  @Field({ type: StringField })
  name!: string;
}

@Model()
class Event {
  @Field({ type: DateField })
  date!: string;

  @Field({ type: UnionOf(StringField, NumberField) })
  value!: string | number;

  @Field({ type: DiscriminatedUnion("kind", { cat: Cat, dog: Dog }) })
  pet!: Cat | Dog;
}

type TimeWindow = { start: number; end: number };

@Model<TimeWindow>({
  schema: { dependentRequired: { start: ["end"] } },
  validate: (window) =>
    window.start <= window.end
      ? undefined
      : { path: "end", message: "Must not be before start" },
})
class WindowModel {
  @Field({ type: NumberField })
  start!: number;

  @Field({ type: NumberField })
  end!: number;
}
```

Model-level `validate` runs after declared fields validate and returns one or
more `{ path, message }` issues. Pass the model data type to `@Model<T>()` for
typed cross-field checks. The optional `description` is included in the model's
OpenAPI schema, while `schema` adds extra JSON Schema/OpenAPI keywords such as
`dependentRequired` or `if`/`then`.

Models can be composed as nested fields with `@Field({ model: OtherModel })`;
validation is recursive and OpenAPI uses a shared schema reference. They can
also be extended with normal class inheritance: decorate the base and derived
classes with `@Model()`, and the derived model inherits the base fields and
model options while adding or overriding fields. This keeps shared constraints
in one place instead of duplicating them across related models.

## Common commands

```sh
pnpm build       # build all TypeScript projects
pnpm typecheck   # type-check all projects
pnpm test        # run workspace tests
pnpm clean       # clean TypeScript build outputs
pnpm docs:dev    # develop the documentation site
pnpm docs:build  # build the static documentation site
```

The server package also includes a routing benchmark:

```sh
pnpm --filter @restfx/server bench:routing
```

## License

RestFX is licensed under the [Apache License 2.0](LICENSE).
