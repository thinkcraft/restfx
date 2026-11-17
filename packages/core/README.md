# `@framework/core`

`@framework/core` contains browser-safe shared models, field types, validation,
and a small typed configuration helper. It has no dependency on Node.js or the
HTTP server, so model classes can be imported by server and client code alike.

## Contents

- [Define and validate a model](#define-and-validate-a-model)
- [Field types and options](#field-types-and-options)
- [Nested models and inheritance](#nested-models-and-inheritance)
- [Cross-field validation and schemas](#cross-field-validation-and-schemas)
- [Request-source metadata](#request-source-metadata)
- [Configuration helper](#configuration-helper)

## Define and validate a model

Decorate a class with `@Model()` and each accepted property with `@Field()`.
These are standard TypeScript decorators, not the legacy
`experimentalDecorators` model. Fields are required unless marked optional;
validation returns an instance containing only the declared fields:

```ts
import {
  Email,
  Field,
  Model,
  StringField,
  validateModel,
} from "@framework/core";

@Model()
class CreateUser {
  @Field({ type: Email })
  email!: string;

  @Field({ type: StringField, minLength: 2, maxLength: 80 })
  name!: string;

  @Field({ type: StringField, optional: true })
  nickname?: string;
}

const input = validateModel(
  { email: "ada@example.test", name: "Ada", ignored: true },
  CreateUser,
);
// input is a CreateUser instance; `ignored` is stripped by default.
```

Validation does not call the model constructor. Invalid input throws
`ModelValidationError`, whose `issues` property contains `{ path, message }`
entries. Models strip undeclared properties by default; use
`@Model({ unknownFields: "reject" })` to reject them instead. Call
`validateModel(value, ModelClass, { unknownFields: "strip" | "reject" })` to
override that policy for a single validation.

## Field types and options

Built-in field types are exported from `@framework/core`:

- `StringField`, `BooleanField`, `NumberField`, and `IntegerField`
- `Email` and `UUID` for validated strings with corresponding schema formats
- `DateField`, `TimeField`, and `DateTimeField` for validated ISO/RFC 3339
  strings (the values remain strings)
- `Enum([...])` for a literal set of allowed values
- `ArrayOf(FieldType | Model)` for arrays of a field type or decorated model
- `UnionOf(...FieldTypes)` and `DiscriminatedUnion(key, variants)` for union
  values and decorated model variants

Common `@Field` options include:

| Option                                  | Behavior                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `optional`                              | Allows the property to be omitted.                                              |
| `nullable`                              | Allows an explicit `null`; omission is still controlled by `optional`.          |
| `default`                               | Supplies a value only when the property is omitted. Object defaults are cloned. |
| `minLength`, `maxLength`, `pattern`     | Constrain string values.                                                        |
| `minimum`, `maximum`                    | Constrain numeric values.                                                       |
| `minItems`, `maxItems`, `uniqueItems`   | Constrain array values.                                                         |
| `description`, `examples`, `deprecated` | Add documentation metadata for generated schemas.                               |
| `schema`                                | Add JSON Schema keywords for a custom field type.                               |

Constraints are checked at runtime and represented in generated OpenAPI schemas.
For schema formats and server integration, see the
[`@framework/server` guide](../server/README.md#shared-models).

## Nested models and inheritance

Use the `model` option to compose a decorated model as a nested object. Derived
models inherit decorated base fields and options; a derived field with the same
name overrides the inherited field:

```ts
import { Field, Model, StringField } from "@framework/core";

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

Nested validation is recursive and reports paths such as `address.city`.
Validation creates nested model instances without invoking their constructors.
Model-level options and validators are inherited; derived schema keywords merge
with base schema keywords, with derived keys taking precedence.

## Cross-field validation and schemas

Use `@Model<T>({ validate })` for checks that involve more than one field. A
validator can return nothing, one issue, or an array of issues. The generic
provides a typed view of the validated model data:

```ts
import { Field, Model, NumberField } from "@framework/core";

type DateRange = { start: number; end: number };

@Model<DateRange>({
  validate: (range) =>
    range.start <= range.end
      ? undefined
      : { path: "end", message: "Must not be before start" },
  schema: { dependentRequired: { start: ["end"] } },
})
class DateRangeModel {
  @Field({ type: NumberField })
  start!: number;

  @Field({ type: NumberField })
  end!: number;
}
```

The validator runs after field validation. In an inheritance chain, base and
derived validators both run. `schema` adds JSON Schema/OpenAPI keywords; it
does not replace runtime validation, so enforce application rules in the
validator as well.

## Request-source metadata

Fields can optionally describe HTTP input locations with `source: "path"`,
`"query"`, or `"header"`; `sourceName` changes the external parameter name.
Nested body models can use `source: "body"`. This metadata is defined in core
to keep the model reusable, but HTTP parsing and source conversion are handled
by `@framework/server`. See its
[combined request model guide](../server/README.md#combined-request-models).

## Configuration helper

`defineConfig()` preserves and type-checks a configuration object against the
small `FrameworkConfig` shape, which currently contains an optional `port`:

```ts
import { defineConfig } from "@framework/core";

export default defineConfig({ port: 3000 });
```

The helper does not load files, read environment variables, or start a server;
applications decide how configuration is sourced and applied.
