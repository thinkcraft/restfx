import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ArrayOf,
  BooleanField,
  Email,
  Field,
  IntegerField,
  Model,
  ModelValidationError,
  NumberField,
  StringField,
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

@Model({ unknownFields: "strip" })
class BaseModel {
  @Field({ type: StringField })
  inherited!: string;
}

@Model()
class DerivedModel extends BaseModel {
  @Field({ type: NumberField })
  own!: number;
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
