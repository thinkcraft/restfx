---
title: Models and validation
description: Define shared TypeScript models and validate untrusted input at runtime.
---

The `@restfx/core` package provides browser-safe model decorators, field types,
and runtime validation. The same model metadata can be used by server routes,
OpenAPI generation, and generated clients. Core has no Node.js or HTTP-server
dependency, so model classes can be imported by both browser and server code.

## Define a model

Decorate a class with `@Model()` and each accepted property with `@Field()`:

```ts
import { Email, Field, Model, StringField, validateModel } from "@restfx/core";

@Model()
class CreateUser {
  @Field({ type: Email })
  email!: string;

  @Field({ type: StringField, minLength: 2, maxLength: 80 })
  name!: string;

  @Field({ type: StringField, optional: true })
  nickname?: string;
}

const user = validateModel(
  { email: "ada@example.test", name: "Ada", ignored: true },
  CreateUser,
);
// `user` is a CreateUser instance; unknown fields are stripped by default.
```

Use the validated result, rather than the original input, in application code.
For example, `validateModel` is useful when validating data outside an HTTP
route, such as a message from a queue or data read from an untyped source:

```ts
import { ModelValidationError, validateModel } from "@restfx/core";

function readUser(input: unknown) {
  try {
    const user = validateModel(input, CreateUser);
    return `${user.name} <${user.email}>`;
  } catch (error) {
    if (error instanceof ModelValidationError) {
      return error.issues; // Each issue has a `path` and a `message`.
    }
    throw error;
  }
}
```

The server validates route request bodies automatically when a model is
declared in the route options; see [request validation](../server/#request-validation).

Validation does not invoke the model constructor. It returns an instance
containing declared fields, with nested models validated recursively. Invalid
input throws `ModelValidationError`; its `issues` array contains `{ path,
message }` entries (for example, `address.city`). Models strip unknown fields by
default; use `@Model({ unknownFields: "reject" })` to reject them. The policy can
also be overridden for an individual call with
`validateModel(value, ModelClass, { unknownFields: "reject" })`.

## Field types and constraints

Built-in field types exported by core are:

- `StringField`, `BooleanField`, `NumberField`, and `IntegerField`.
- `Email` and `UUID`, which validate strings and emit schema formats.
- `DateField`, `TimeField`, and `DateTimeField`, which validate ISO/RFC 3339
  strings. Values remain strings; they are not converted to JavaScript `Date`s.
- `Enum([...])` for a fixed set of values.
- `ArrayOf(FieldType | Model)` for arrays.
- `UnionOf(...FieldTypes)` and `DiscriminatedUnion(key, variants)` for union
  values and decorated model variants.

`@Field` options describe presence, constraints, and schema documentation:

| Option                                  | Behavior                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `optional`                              | Allows the property to be omitted.                                                                               |
| `nullable`                              | Allows explicit `null`; omission still depends on `optional`.                                                    |
| `default`                               | Used only when omitted. Object defaults are cloned; defaults are checked against the field type and constraints. |
| `minLength`, `maxLength`, `pattern`     | Constrain strings. `pattern` takes a `RegExp`.                                                                   |
| `minimum`, `maximum`                    | Constrain numbers.                                                                                               |
| `minItems`, `maxItems`, `uniqueItems`   | Constrain array size and uniqueness.                                                                             |
| `description`, `examples`, `deprecated` | Add documentation metadata to generated schemas.                                                                 |
| `schema`                                | Adds JSON Schema keywords, especially for custom field types.                                                    |

Constraints are checked at runtime and represented in generated JSON Schema and
OpenAPI where supported. Schema metadata does not perform runtime validation;
enforce application rules with a field type or model validator too.

For example, use `Enum` for a fixed set of values and `ArrayOf` for repeated
values. Optional and nullable are independent: this `description` can be
omitted, set to `null`, or contain a string. The default is applied only when
`visibility` is omitted:

```ts
import { ArrayOf, Enum, Field, Model, StringField } from "@restfx/core";

@Model()
class CreateProject {
  @Field({ type: StringField, minLength: 1, maxLength: 100 })
  name!: string;

  @Field({ type: Enum(["private", "public"]), default: "private" })
  visibility!: "private" | "public";

  @Field({ type: ArrayOf(StringField), optional: true, uniqueItems: true })
  tags?: string[];

  @Field({ type: StringField, optional: true, nullable: true })
  description?: string | null;
}
```

The TypeScript property type should reflect the field's runtime behavior. In
particular, mark nullable fields with `| null`; `optional` controls whether a
property may be absent, while `nullable` controls whether its value may be
`null`.

## Nested models and inheritance

Use `model` to compose a decorated model as a nested object. Derived models
inherit decorated base fields and model options; a derived field with the same
name overrides the inherited field:

```ts
@Model()
class Address {
  @Field({ type: StringField })
  city!: string;
}

@Model({ unknownFields: "reject" })
class CreateProfile {
  @Field({ type: StringField })
  name!: string;

  @Field({ model: Address })
  address!: Address;
}

@Model()
class AdminProfile extends CreateProfile {
  @Field({ type: StringField })
  role!: string;
}
```

Nested values become model instances without calling constructors. Base and
derived model validators both run. Schema keywords merge across inheritance,
with derived keys taking precedence.

## Cross-field validation

Use a model-level `validate` callback when correctness depends on multiple
fields. It runs after field validation and may return no issue, one issue, or an
array of issues:

```ts
type DateRange = { start: number; end: number };

@Model<DateRange>({
  validate: ({ start, end }) =>
    start <= end
      ? undefined
      : { path: "end", message: "Must not precede start" },
})
class DateRangeModel {
  @Field({ type: NumberField })
  start!: number;

  @Field({ type: NumberField })
  end!: number;
}
```

## Request-source metadata

Core fields can declare `source: "path" | "query" | "header"` and an optional
`sourceName` for the external parameter name. A nested model can use
`source: "body"`. This metadata lets one model describe both the shape and
validation rules and where the server reads each value. Pass that model to a
route decorator with its `request` option, then read the validated instance
with `context.req.model()`:

```ts
import { BooleanField, Field, Model, UUID } from "@restfx/core";
import { HttpContext, HttpGet, HttpResource } from "@restfx/server";

@Model()
class GetProjectRequest {
  @Field({ type: UUID, source: "path" })
  projectId!: string;

  @Field({ type: BooleanField, optional: true, source: "query" })
  includeTasks?: boolean;
}

@HttpResource("projects")
class ProjectsResource {
  @HttpGet({ path: ":projectId", request: GetProjectRequest })
  async get(context: HttpContext) {
    const request = await context.req.model(GetProjectRequest);
    return {
      id: request.projectId,
      includeTasks: request.includeTasks ?? false,
    };
  }
}
```

`request` is for models assembled from path, query, header, and/or body fields.
For a body-only model, use the decorator's `body` option and
`context.req.parseBody()`. A route can use either `request` or `body`, not both.
The server validates request models before calling the handler and generates
OpenAPI parameters and body schemas from their metadata. Core itself does not
parse HTTP input; see [combined request models](../request-handling/) for body
fields, source-name overrides, and more examples.

## Typed configuration

`defineConfig()` preserves and type-checks an object against the small
`FrameworkConfig` shape, which currently contains an optional `port`:

```ts
import { defineConfig } from "@restfx/core";

export default defineConfig({ port: 3000 });
```

It does not load files, read environment variables, or start the server; the
application chooses how configuration is sourced and applied.

For the full reference, see the [`@restfx/core` README](https://github.com/thinkcraft/restfx/blob/main/packages/core/README.md).

For all field types, options, and model behaviors, see the
[`@restfx/core` README](https://github.com/thinkcraft/restfx/blob/main/packages/core/README.md).
