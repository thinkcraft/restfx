import type {
  ModelConstructor,
  ModelFieldMetadata,
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
  if (unknownFields === "reject")
    validateUnknownFields(input, metadata.fields, issues);

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
    validateField(name, field, input, assign, issues);
  }

  if (issues.length === 0) {
    for (const validate of metadata.validators) {
      const result = validate(output);
      if (result === undefined) continue;
      if (Array.isArray(result)) issues.push(...result);
      else issues.push(result as ValidationIssue);
    }
  }

  if (issues.length > 0) throw new ModelValidationError(issues);
  return output as T;
}

function validateUnknownFields(
  input: Record<string, unknown>,
  fields: ReadonlyMap<string, unknown>,
  issues: ValidationIssue[],
) {
  for (const key of Object.keys(input)) {
    if (!fields.has(key)) issues.push({ path: key, message: "Unknown field" });
  }
}

function validateField(
  name: string,
  field: ModelFieldMetadata,
  input: Record<string, unknown>,
  assign: (name: string, value: unknown) => void,
  issues: ValidationIssue[],
) {
  if (!Object.hasOwn(input, name)) {
    assignMissingField(name, field, assign, issues);
    return;
  }

  const value = input[name];
  if (value === null) {
    if (field.nullable) assign(name, null);
    else issues.push({ path: name, message: "Null is not allowed" });
    return;
  }
  if (field.model) {
    validateNestedField(name, value, field.model, assign, issues);
    return;
  }
  if (!field.type) throw new TypeError(`Field ${name} is missing a field type`);

  const fieldType = new field.type();
  const typeError = fieldType.validate(value);
  if (typeError !== undefined) {
    issues.push({ path: name, message: typeError });
    return;
  }
  validateConstraints(value, field, name, issues);
  assign(name, fieldType.parse ? fieldType.parse(value) : value);
}

function assignMissingField(
  name: string,
  field: ModelFieldMetadata,
  assign: (name: string, value: unknown) => void,
  issues: ValidationIssue[],
) {
  if (field.default !== undefined) {
    const defaultValue = cloneDefault(field.default);
    const fieldType = field.type ? new field.type() : undefined;
    assign(
      name,
      fieldType?.parse ? fieldType.parse(defaultValue) : defaultValue,
    );
  } else if (!field.optional) {
    issues.push({ path: name, message: "Field is required" });
  }
}

function validateNestedField(
  name: string,
  value: unknown,
  model: ModelConstructor,
  assign: (name: string, value: unknown) => void,
  issues: ValidationIssue[],
) {
  try {
    assign(name, validateModel(value, model));
  } catch (error) {
    if (!(error instanceof ModelValidationError)) throw error;
    issues.push(
      ...error.issues.map((issue) => ({
        path: issue.path ? `${name}.${issue.path}` : name,
        message: issue.message,
      })),
    );
  }
}
