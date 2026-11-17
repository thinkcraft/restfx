import type {
  ModelConstructor,
  ModelOptions,
  ValidationIssue,
} from "./types.js";
import { cloneDefault, validateConstraints } from "./fieldOptions.js";
import { ModelValidationError } from "./ModelValidationError.js";
import { getModelMetadata } from "./metadata.js";

/**
 * Validates and returns a model instance containing only declared model fields.
 * The instance is created without invoking the model constructor.
 */
export function validateModel<T>(
  value: unknown,
  model: ModelConstructor<T>,
  options: ModelOptions = {},
): T {
  const metadata = getModelMetadata(model);
  if (!metadata) {
    throw new TypeError(
      `${model.name || "Model"} is not decorated with @Model`,
    );
  }

  const issues: ValidationIssue[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelValidationError([
      { path: "", message: "Expected an object" },
    ]);
  }

  const input = value as Record<string, unknown>;
  const unknownFields =
    options.unknownFields ?? metadata.options.unknownFields ?? "strip";
  if (unknownFields === "reject") {
    for (const key of Object.keys(input)) {
      if (!metadata.fields.has(key)) {
        issues.push({ path: key, message: "Unknown field" });
      }
    }
  }

  const output = Object.create(model.prototype) as Record<string, unknown>;
  const assign = (name: string, fieldValue: unknown) => {
    Object.defineProperty(output, name, {
      configurable: true,
      enumerable: true,
      value: fieldValue,
      writable: true,
    });
  };

  for (const [name, field] of metadata.fields) {
    if (!Object.hasOwn(input, name)) {
      if (field.default !== undefined) {
        assign(name, cloneDefault(field.default));
      } else if (!field.optional) {
        issues.push({ path: name, message: "Field is required" });
      }
      continue;
    }

    const fieldValue = input[name];
    if (fieldValue === null) {
      if (field.nullable) assign(name, null);
      else issues.push({ path: name, message: "Null is not allowed" });
      continue;
    }

    const typeError = new field.type().validate(fieldValue);
    if (typeError !== undefined) {
      issues.push({ path: name, message: typeError });
      continue;
    }

    validateConstraints(fieldValue, field, name, issues);
    assign(name, fieldValue);
  }

  if (issues.length > 0) throw new ModelValidationError(issues);
  return output as T;
}
