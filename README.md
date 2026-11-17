# Framework

A TypeScript-first full-stack framework monorepo managed with pnpm. The
workspace currently provides shared configuration helpers, a browser fetch
client, and a Node.js HTTP server with decorator-based resources and routing.

## Requirements

- Node.js 24 or newer
- pnpm 11

## Workspace packages

- `packages/core` (`@framework/core`) — shared models, field validation,
  enum field types, and typed framework configuration via `defineConfig`.
- `packages/client` (`@framework/client`) — a small configurable fetch client.
- `packages/server` (`@framework/server`) — Node.js HTTP server, decorated
  resources, middleware, routing, and request-body parsing. See the
  [server README](packages/server/README.md) for usage and behavior.
- `apps/playground` — runnable example application.

## Getting started

```sh
pnpm install
pnpm dev
```

The playground listens on <http://localhost:3000>. Set `PORT` to change the
port.

Open the interactive Swagger UI reference at <http://localhost:3000/docs>; the raw
OpenAPI document is at <http://localhost:3000/openapi.json>. The sample API
models a workspace with nested projects and tasks, including validated request
bodies, query filters, and CRUD-style operations. Its seeded workspace ID is
`550e8400-e29b-41d4-a716-446655440000`; for example:

```sh
curl "http://localhost:3000/workspaces/550e8400-e29b-41d4-a716-446655440000/projects?status=active&limit=10"
```

The playground includes an end-to-end test that runs its generated client
against the in-process HTTP server and checks the OpenAPI document, successful
operations, duplicate conflicts, and request validation. `pnpm test` runs this
alongside the package tests. The server's request lifecycle hooks and
`X-Request-Id` correlation behavior are demonstrated in the playground logs.

Use `Enum` for fields whose values are restricted to a fixed set. It infers the
literal union, validates values at runtime, and generates the corresponding
OpenAPI enum schema:

```ts
import { Enum, Field, Model } from "@framework/core";

@Model()
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
} from "@framework/core";

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
typed cross-field checks. The optional `schema` model option adds extra JSON
Schema/OpenAPI keywords such as `dependentRequired` or `if`/`then`.

## Common commands

```sh
pnpm build       # build all TypeScript projects
pnpm typecheck   # type-check all projects
pnpm test        # run workspace tests
pnpm clean       # clean TypeScript build outputs
```

The server package also includes a routing benchmark:

```sh
pnpm --filter @framework/server bench:routing
```
