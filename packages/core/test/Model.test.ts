import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ArrayOf,
  BooleanField,
  DateField,
  DateTimeField,
  DiscriminatedUnion,
  Email,
  Enum,
  Field,
  getModelMetadata,
  IntegerField,
  Model,
  ModelValidationError,
  NumberField,
  StringField,
  TimeField,
  UnionOf,
  UUID,
  validateModel,
} from "../src";

@Model()
class ProfileModel {
  @Field({ type: StringField, minLength: 2 })
  name!: string;

  @Field({ type: Email, optional: true })
  email?: string;

  @Field({ type: ArrayOf(StringField), minItems: 1, uniqueItems: true })
  tags!: string[];
}

@Model({ unknownFields: "reject" })
class StrictProfileModel extends ProfileModel {}

@Model()
class DefaultedModel {
  @Field({ type: StringField, default: "guest" })
  name!: string;

  @Field({ type: ArrayOf(StringField), default: ["new"] })
  tags!: string[];
}

@Model()
class ConstraintModel {
  @Field({
    type: StringField,
    minLength: 2,
    maxLength: 4,
    pattern: /^[A-Z]+$/g,
  })
  code!: string;

  @Field({ type: NumberField, minimum: 0, maximum: 10 })
  score!: number;

  @Field({ type: IntegerField, minimum: -2, maximum: 2 })
  rank!: number;

  @Field({ type: BooleanField })
  active!: boolean;

  @Field({
    type: ArrayOf(StringField),
    minItems: 1,
    maxItems: 2,
    uniqueItems: true,
  })
  labels!: string[];
}

@Model()
class PresenceModel {
  @Field({ type: StringField })
  required!: string;

  @Field({ type: StringField, optional: true })
  optional?: string;

  @Field({ type: StringField, nullable: true })
  nullable!: string | null;

  @Field({ type: StringField, optional: true, nullable: true })
  optionalNullable?: string | null;

  @Field({
    type: StringField,
    nullable: true,
    default: null as unknown as string,
  })
  nullDefault!: string | null;
}

@Model({ unknownFields: "reject" })
class BaseModel {
  @Field({ type: StringField })
  inherited!: string;
}

@Model({ unknownFields: "strip" })
class DerivedModel extends BaseModel {
  @Field({ type: NumberField })
  own!: number;
}

@Model()
class StrictDerivedModel extends BaseModel {
  @Field({ type: NumberField })
  own!: number;
}

@Model()
class AddressModel {
  @Field({ type: StringField })
  city!: string;
}

@Model()
class ComposedProfileModel {
  @Field({ type: StringField })
  name!: string;

  @Field({ model: AddressModel })
  address!: AddressModel;
}

@Model()
class SpecialPropertyModel {
  @Field({ type: StringField })
  ["__proto__"]!: string;
}

@Model()
class UUIDModel {
  @Field({ type: UUID })
  id!: string;
}

@Model()
class RequestBodyModel {
  @Field({ type: StringField, minLength: 2 })
  label!: string;
}

@Model()
class EnumModel {
  @Field({ type: Enum(["active", "archived"]) })
  status!: "active" | "archived";
}

@Model()
class SourcedRequestModel {
  @Field({ type: UUID, source: "path" })
  id!: string;

  @Field({ type: StringField, source: "query", sourceName: "q" })
  search!: string;

  @Field({ model: RequestBodyModel, source: "body" })
  body!: RequestBodyModel;
}

@Model()
class TemporalModel {
  @Field({ type: DateField })
  date!: string;

  @Field({ type: TimeField })
  time!: string;

  @Field({ type: DateTimeField })
  timestamp!: string;
}

@Model()
class CatModel {
  @Field({ type: Enum(["cat"]) })
  kind!: "cat";

  @Field({ type: StringField })
  meows!: string;
}

@Model()
class DogModel {
  @Field({ type: Enum(["dog"]) })
  kind!: "dog";

  @Field({ type: BooleanField })
  goodBoy!: boolean;
}

@Model()
class PetModel {
  @Field({ type: DiscriminatedUnion("kind", { cat: CatModel, dog: DogModel }) })
  pet!: CatModel | DogModel;

  @Field({
    type: ArrayOf(DiscriminatedUnion("kind", { cat: CatModel, dog: DogModel })),
    optional: true,
  })
  pets?: (CatModel | DogModel)[];
}

@Model()
class FlexibleValueModel {
  @Field({ type: UnionOf(StringField, NumberField) })
  value!: string | number;
}

type RangeData = { start: number; end: number };

@Model<RangeData>({
  schema: { dependentRequired: { start: ["end"] } },
  validate: (value) =>
    value.start <= value.end
      ? undefined
      : { path: "end", message: "Must not be before start" },
})
class RangeModel {
  @Field({ type: NumberField })
  start!: number;

  @Field({ type: NumberField })
  end!: number;
}

class UndecoratedModel {}

function captureModelError(action: () => unknown) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof ModelValidationError);
    return error;
  }
  assert.fail("Expected model validation to fail");
}

function assertModelData(actual: object, expected: object) {
  assert.deepEqual({ ...actual }, expected);
}

describe("shared model decorators", () => {
  it("validates ISO date, time, and date-time formats", () => {
    assertModelData(
      validateModel(
        {
          date: "2024-02-29",
          time: "12:30:45.123Z",
          timestamp: "2024-02-29T12:30:45+01:00",
        },
        TemporalModel,
      ),
      {
        date: "2024-02-29",
        time: "12:30:45.123Z",
        timestamp: "2024-02-29T12:30:45+01:00",
      },
    );
    const invalidDate = captureModelError(() =>
      validateModel(
        {
          date: "2023-02-29",
          time: "12:30:45",
          timestamp: "2024-01-01T00:00:00Z",
        },
        TemporalModel,
      ),
    );
    assert.equal(invalidDate.issues[0]?.path, "date");
    const invalidTime = captureModelError(() =>
      validateModel(
        {
          date: "2024-01-01",
          time: "25:00:00",
          timestamp: "2024-01-01T00:00:00Z",
        },
        TemporalModel,
      ),
    );
    assert.equal(invalidTime.issues[0]?.path, "time");
  });

  it("validates unions and returns normalized discriminated model instances", () => {
    assertModelData(validateModel({ value: "text" }, FlexibleValueModel), {
      value: "text",
    });
    assertModelData(validateModel({ value: 42 }, FlexibleValueModel), {
      value: 42,
    });
    assert.equal(
      captureModelError(() =>
        validateModel({ value: false }, FlexibleValueModel),
      ).issues[0]?.path,
      "value",
    );

    const cat = validateModel(
      { pet: { kind: "cat", meows: "often", ignored: true } },
      PetModel,
    );
    assert.ok(cat.pet instanceof CatModel);
    assertModelData(cat.pet, { kind: "cat", meows: "often" });
    const pets = validateModel(
      {
        pet: { kind: "cat", meows: "often" },
        pets: [
          { kind: "dog", goodBoy: true },
          { kind: "cat", meows: "always" },
        ],
      },
      PetModel,
    );
    assert.ok(pets.pets?.[0] instanceof DogModel);
    assert.ok(pets.pets?.[1] instanceof CatModel);
    assert.ok(
      captureModelError(() =>
        validateModel({ pet: { kind: "dog", goodBoy: "yes" } }, PetModel),
      ).issues[0]?.message.includes("Expected a boolean"),
    );
  });

  it("runs cross-field validation on validated values and supports model schemas", () => {
    assertModelData(validateModel({ start: 1, end: 2 }, RangeModel), {
      start: 1,
      end: 2,
    });
    const error = captureModelError(() =>
      validateModel({ start: 4, end: 2 }, RangeModel),
    );
    assert.deepEqual(error.issues, [
      { path: "end", message: "Must not be before start" },
    ]);
    assert.deepEqual(getModelMetadata(RangeModel)?.options.schema, {
      dependentRequired: { start: ["end"] },
    });
  });

  it("validates canonical UUID field values", () => {
    assertModelData(
      validateModel({ id: "550e8400-e29b-41d4-a716-446655440000" }, UUIDModel),
      { id: "550e8400-e29b-41d4-a716-446655440000" },
    );
    const error = captureModelError(() =>
      validateModel({ id: "not-a-uuid" }, UUIDModel),
    );
    assert.equal(error.issues[0]?.path, "id");
    assert.equal(error.issues[0]?.message, "Expected a valid UUID");
  });

  it("validates fields and returns a model instance with declared fields", () => {
    const value = validateModel(
      {
        name: "Jane",
        email: "jane@example.com",
        tags: ["admin"],
        unexpected: "discarded",
      },
      ProfileModel,
    );

    assert.equal(value instanceof ProfileModel, true);
    assert.deepEqual(
      { ...value },
      {
        name: "Jane",
        email: "jane@example.com",
        tags: ["admin"],
      },
    );
    assert.equal(Object.getPrototypeOf(value), ProfileModel.prototype);
  });

  it("stores request sources in core metadata and validates nested body models", () => {
    const metadata = getModelMetadata(SourcedRequestModel)!;
    assert.equal(metadata.fields.get("id")?.source, "path");
    assert.equal(metadata.fields.get("search")?.source, "query");
    assert.equal(metadata.fields.get("search")?.sourceName, "q");
    assert.equal(metadata.fields.get("body")?.source, "body");

    const value = validateModel(
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        search: "term",
        body: { label: "ok", extra: true },
      },
      SourcedRequestModel,
    );
    assert.equal(value.body instanceof RequestBodyModel, true);
    assertModelData(value.body, { label: "ok" });

    const error = captureModelError(() =>
      validateModel(
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          search: "term",
          body: { label: "x" },
        },
        SourcedRequestModel,
      ),
    );
    assert.deepEqual(error.issues, [
      { path: "body.label", message: "Must contain at least 2 characters" },
    ]);
  });

  it("validates enum fields against their literal options", () => {
    assertModelData(validateModel({ status: "active" }, EnumModel), {
      status: "active",
    });
    const error = captureModelError(() =>
      validateModel({ status: "pending" }, EnumModel),
    );
    assert.deepEqual(error.issues, [
      { path: "status", message: "Expected one of: active, archived" },
    ]);
  });

  it("applies defaults only to omitted fields and strips unknown fields", () => {
    assertModelData(validateModel({ ignored: true }, DefaultedModel), {
      name: "guest",
      tags: ["new"],
    });
    assertModelData(
      validateModel(
        { name: "Ada", tags: ["custom"], ignored: true },
        DefaultedModel,
      ),
      { name: "Ada", tags: ["custom"] },
    );
  });

  it("clones object defaults for each validation", () => {
    const first = validateModel({}, DefaultedModel);
    const second = validateModel({}, DefaultedModel);

    first.tags.push("changed");
    assert.deepEqual(second.tags, ["new"]);
    assert.notEqual(first.tags, second.tags);
  });

  it("reports missing, unknown, and invalid fields as path-specific issues", () => {
    const error = captureModelError(() =>
      validateModel(
        {
          name: "J",
          email: "invalid",
          tags: ["duplicate", "duplicate"],
          extra: true,
        },
        StrictProfileModel,
      ),
    );

    assert.deepEqual(error.issues.map(({ path }) => path).sort(), [
      "email",
      "extra",
      "name",
      "tags",
    ]);
    assert.deepEqual(
      error.issues.map(({ path, message }) => [path, message]),
      [
        ["extra", "Unknown field"],
        ["name", "Must contain at least 2 characters"],
        ["email", "Expected a valid email address"],
        ["tags", "Items must be unique"],
      ],
    );
  });

  it("distinguishes required, optional, nullable, and optional-nullable fields", () => {
    const omitted = validateModel(
      { required: "yes", nullable: null },
      PresenceModel,
    );
    assertModelData(omitted, {
      required: "yes",
      nullable: null,
      nullDefault: null,
    });

    assertModelData(
      validateModel(
        {
          required: "yes",
          optional: "present",
          nullable: "present",
          optionalNullable: null,
          nullDefault: "overridden",
        },
        PresenceModel,
      ),
      {
        required: "yes",
        optional: "present",
        nullable: "present",
        optionalNullable: null,
        nullDefault: "overridden",
      },
    );

    const requiredError = captureModelError(() =>
      validateModel({ nullable: "ok" }, PresenceModel),
    );
    assert.deepEqual(requiredError.issues, [
      { path: "required", message: "Field is required" },
    ]);

    const nullError = captureModelError(() =>
      validateModel(
        { required: "yes", optional: null, nullable: null },
        PresenceModel,
      ),
    );
    assert.deepEqual(nullError.issues, [
      { path: "optional", message: "Null is not allowed" },
    ]);
  });

  it("accepts inclusive scalar and array constraint boundaries", () => {
    assertModelData(
      validateModel(
        {
          code: "AB",
          score: 0,
          rank: -2,
          active: false,
          labels: ["one"],
        },
        ConstraintModel,
      ),
      {
        code: "AB",
        score: 0,
        rank: -2,
        active: false,
        labels: ["one"],
      },
    );
    assertModelData(
      validateModel(
        {
          code: "ABCD",
          score: 10,
          rank: 2,
          active: true,
          labels: ["one", "two"],
        },
        ConstraintModel,
      ),
      {
        code: "ABCD",
        score: 10,
        rank: 2,
        active: true,
        labels: ["one", "two"],
      },
    );
  });

  it("reports scalar and array constraint failures", () => {
    const error = captureModelError(() =>
      validateModel(
        {
          code: "a1bcd",
          score: -1,
          rank: 1.5,
          active: "yes",
          labels: ["same", "same", "extra"],
        },
        ConstraintModel,
      ),
    );

    assert.deepEqual(
      error.issues.map(({ path, message }) => [path, message]),
      [
        ["code", "Must contain at most 4 characters"],
        ["code", "Does not match the required pattern"],
        ["score", "Must be at least 0"],
        ["rank", "Expected a safe integer"],
        ["active", "Expected a boolean"],
        ["labels", "Must contain at most 2 items"],
        ["labels", "Items must be unique"],
      ],
    );
  });

  it("enforces lower bounds and rejects invalid email and array elements", () => {
    const constraintError = captureModelError(() =>
      validateModel(
        { code: "A", score: 1, rank: 0, active: true, labels: [] },
        ConstraintModel,
      ),
    );
    assert.deepEqual(
      constraintError.issues.map(({ path, message }) => [path, message]),
      [
        ["code", "Must contain at least 2 characters"],
        ["labels", "Must contain at least 1 items"],
      ],
    );

    const emailError = captureModelError(() =>
      validateModel(
        { name: "Jane", email: "not-an-email", tags: ["ok"] },
        ProfileModel,
      ),
    );
    assert.deepEqual(emailError.issues, [
      { path: "email", message: "Expected a valid email address" },
    ]);

    const itemError = captureModelError(() =>
      validateModel({ name: "Jane", tags: ["ok", 42] }, ProfileModel),
    );
    assert.deepEqual(itemError.issues, [
      { path: "tags", message: "Item 1: Expected a string" },
    ]);

    const arrayError = captureModelError(() =>
      validateModel({ name: "Jane", tags: "not-an-array" }, ProfileModel),
    );
    assert.deepEqual(arrayError.issues, [
      { path: "tags", message: "Expected an array" },
    ]);
  });

  it("supports per-call unknown-field policy overrides", () => {
    assertModelData(
      validateModel({ name: "Jane", tags: ["one"], extra: true }, ProfileModel),
      { name: "Jane", tags: ["one"] },
    );

    const error = captureModelError(() =>
      validateModel(
        { name: "Jane", tags: ["one"], extra: true },
        ProfileModel,
        { unknownFields: "reject" },
      ),
    );
    assert.deepEqual(error.issues, [
      { path: "extra", message: "Unknown field" },
    ]);

    const modelPolicyError = captureModelError(() =>
      validateModel(
        { name: "Jane", tags: ["one"], extra: true },
        StrictProfileModel,
      ),
    );
    assert.deepEqual(modelPolicyError.issues, [
      { path: "extra", message: "Unknown field" },
    ]);

    assertModelData(
      validateModel(
        { name: "Jane", tags: ["one"], extra: true },
        StrictProfileModel,
        { unknownFields: "strip" },
      ),
      { name: "Jane", tags: ["one"] },
    );
  });

  it("inherits fields and model options", () => {
    assertModelData(
      validateModel({ inherited: "base", own: 1, ignored: true }, DerivedModel),
      { inherited: "base", own: 1 },
    );

    const strictError = captureModelError(() =>
      validateModel(
        { inherited: "base", own: 1, extra: true },
        StrictDerivedModel,
      ),
    );
    assert.deepEqual(strictError.issues, [
      { path: "extra", message: "Unknown field" },
    ]);
  });

  it("composes models as reusable nested fields", () => {
    const profile = validateModel(
      {
        name: "Ada",
        address: { city: "London", ignored: true },
        ignored: true,
      },
      ComposedProfileModel,
    );
    assertModelData(
      { ...profile, address: { ...profile.address } },
      { name: "Ada", address: { city: "London" } },
    );

    const error = captureModelError(() =>
      validateModel(
        { name: "Ada", address: { city: 42 } },
        ComposedProfileModel,
      ),
    );
    assert.deepEqual(error.issues, [
      { path: "address.city", message: "Expected a string" },
    ]);
  });

  it("rejects non-object input and models without @Model", () => {
    for (const value of [null, undefined, "text", 12, true, []]) {
      const error = captureModelError(() => validateModel(value, ProfileModel));
      assert.deepEqual(error.issues, [
        { path: "", message: "Expected an object" },
      ]);
    }

    assert.throws(
      () => validateModel({}, UndecoratedModel),
      /UndecoratedModel is not decorated with @Model/,
    );
  });

  it("rejects invalid model and field definitions", () => {
    assert.throws(
      () => Model({ unknownFields: "ignore" } as never),
      /unknownFields must be/,
    );
    assert.throws(
      () => Field({ type: undefined } as never),
      /requires a field type constructor/,
    );
    assert.throws(
      () => Field({ type: StringField, pattern: "not-a-regex" } as never),
      /pattern must be a RegExp/,
    );
    assert.throws(
      () => Field({ type: StringField, optional: "yes" } as never),
      /optional must be a boolean/,
    );
    assert.throws(
      () => Field({ type: NumberField, minimum: Number.NaN }),
      /minimum must be a finite number/,
    );
    assert.throws(
      () => Field({ type: StringField, minLength: -1 }),
      /minLength must be a non-negative safe integer/,
    );
    assert.throws(
      () => Field({ type: StringField, minLength: 4, maxLength: 2 }),
      /minLength cannot be greater than maxLength/,
    );
    assert.throws(
      () => Field({ type: NumberField, minimum: 5, maximum: 2 }),
      /minimum cannot be greater than maximum/,
    );
    assert.throws(
      () => Field({ type: ArrayOf(StringField), minItems: 3, maxItems: 1 }),
      /minItems cannot be greater than maxItems/,
    );
    assert.throws(
      () => Field({ type: StringField, default: "x", minLength: 2 }),
      /Invalid field default/,
    );
    assert.throws(
      () => Field({ type: StringField, default: null as never }),
      /null default requires nullable: true/,
    );
  });

  it("preserves declared special property names as own data properties", () => {
    const value = validateModel(
      JSON.parse('{"__proto__":"safe"}'),
      SpecialPropertyModel,
    );

    assert.equal(Object.getPrototypeOf(value), SpecialPropertyModel.prototype);
    assert.equal(value instanceof SpecialPropertyModel, true);
    assert.equal(Object.hasOwn(value, "__proto__"), true);
    assert.equal(
      (value as unknown as Record<string, unknown>)["__proto__"],
      "safe",
    );
  });
});
