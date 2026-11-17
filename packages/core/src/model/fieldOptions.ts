import type {
  FieldOptions,
  ModelFieldMetadata,
  ModelOptions,
  ValidationIssue,
} from "./types.js";

export function validateModelOptions(options: ModelOptions<any>) {
  if (
    options.validate !== undefined &&
    typeof options.validate !== "function"
  ) {
    throw new TypeError("validate must be a function");
  }
  if (
    options.schema !== undefined &&
    (options.schema === null ||
      typeof options.schema !== "object" ||
      Array.isArray(options.schema))
  ) {
    throw new TypeError("schema must be an object");
  }
  if (
    options.unknownFields !== undefined &&
    options.unknownFields !== "reject" &&
    options.unknownFields !== "strip"
  ) {
    throw new TypeError('unknownFields must be "reject" or "strip"');
  }
}

export function validateFieldOptions(options: FieldOptions) {
  if (options.source === "body") {
    if (typeof options.model !== "function") {
      throw new TypeError('@Field with source "body" requires a model');
    }
  } else if (options.model !== undefined) {
    if (typeof options.model !== "function") {
      throw new TypeError("@Field model must be a model constructor");
    }
    if (options.type !== undefined || options.source !== undefined) {
      throw new TypeError(
        "Nested model fields cannot declare a type or source",
      );
    }
  } else if (
    typeof options.type !== "function" ||
    typeof options.type.prototype?.validate !== "function"
  ) {
    throw new TypeError("@Field requires a field type constructor");
  }
  if (options.sourceName !== undefined && options.source === undefined) {
    throw new TypeError("sourceName requires a path, query, or header source");
  }
  if (options.sourceName !== undefined && options.sourceName.trim() === "") {
    throw new TypeError("sourceName must not be empty");
  }

  if (options.pattern !== undefined && !(options.pattern instanceof RegExp)) {
    throw new TypeError("pattern must be a RegExp");
  }
  for (const name of [
    "optional",
    "nullable",
    "deprecated",
    "uniqueItems",
  ] as const) {
    const value = options[name];
    if (value !== undefined && typeof value !== "boolean") {
      throw new TypeError(`${name} must be a boolean`);
    }
  }

  for (const [name, value] of Object.entries(options)) {
    if (
      ["minLength", "maxLength", "minItems", "maxItems"].includes(name) &&
      value !== undefined &&
      (!Number.isSafeInteger(value) || (value as number) < 0)
    ) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
    if (
      ["minimum", "maximum"].includes(name) &&
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new RangeError(`${name} must be a finite number`);
    }
  }

  if (
    options.minLength !== undefined &&
    options.maxLength !== undefined &&
    options.minLength > options.maxLength
  ) {
    throw new RangeError("minLength cannot be greater than maxLength");
  }
  if (
    options.minimum !== undefined &&
    options.maximum !== undefined &&
    options.minimum > options.maximum
  ) {
    throw new RangeError("minimum cannot be greater than maximum");
  }
  if (
    options.minItems !== undefined &&
    options.maxItems !== undefined &&
    options.minItems > options.maxItems
  ) {
    throw new RangeError("minItems cannot be greater than maxItems");
  }

  if (
    options.model &&
    Object.hasOwn(options, "default") &&
    options.default !== undefined
  ) {
    throw new TypeError("Nested model fields cannot have a default");
  }
  if (
    options.type &&
    Object.hasOwn(options, "default") &&
    options.default !== undefined
  ) {
    const defaultValue = options.default;
    if (defaultValue === null) {
      if (!options.nullable) {
        throw new TypeError("A null default requires nullable: true");
      }
      return;
    }
    const error = new options.type().validate(defaultValue);
    if (error !== undefined) {
      throw new TypeError(`Invalid field default: ${error}`);
    }
    const issues: ValidationIssue[] = [];
    validateConstraints(
      defaultValue,
      { ...options, name: "default" },
      "default",
      issues,
    );
    if (issues.length > 0) {
      throw new TypeError(`Invalid field default: ${issues[0]?.message}`);
    }
  }
}

export function validateConstraints(
  value: unknown,
  field: ModelFieldMetadata,
  path: string,
  issues: ValidationIssue[],
) {
  if (typeof value === "string") {
    if (field.minLength !== undefined && value.length < field.minLength) {
      issues.push({
        path,
        message: `Must contain at least ${field.minLength} characters`,
      });
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      issues.push({
        path,
        message: `Must contain at most ${field.maxLength} characters`,
      });
    }
    if (field.pattern) {
      field.pattern.lastIndex = 0;
      const matches = field.pattern.test(value);
      field.pattern.lastIndex = 0;
      if (!matches) {
        issues.push({ path, message: "Does not match the required pattern" });
      }
    }
  }

  if (typeof value === "number") {
    if (field.minimum !== undefined && value < field.minimum) {
      issues.push({ path, message: `Must be at least ${field.minimum}` });
    }
    if (field.maximum !== undefined && value > field.maximum) {
      issues.push({ path, message: `Must be at most ${field.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (field.minItems !== undefined && value.length < field.minItems) {
      issues.push({
        path,
        message: `Must contain at least ${field.minItems} items`,
      });
    }
    if (field.maxItems !== undefined && value.length > field.maxItems) {
      issues.push({
        path,
        message: `Must contain at most ${field.maxItems} items`,
      });
    }
    if (
      field.uniqueItems &&
      new Set(value.map(stableKey)).size !== value.length
    ) {
      issues.push({ path, message: "Items must be unique" });
    }
  }
}

export function cloneDefault<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    return structuredClone(value);
  }
  return value;
}

function stableKey(value: unknown) {
  if (value !== null && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return value;
    }
  }
  return value;
}
