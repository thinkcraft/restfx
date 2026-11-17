import type { FieldType, FieldTypeConstructor } from "./FieldType.js";

export type EnumValue = string | number | boolean;

/** Creates a field type that validates values against a literal option list. */
export function Enum<const T extends readonly [EnumValue, ...EnumValue[]]>(
  values: T,
): FieldTypeConstructor<T[number]> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("Enum requires at least one value");
  }
  if (
    values.some(
      (value) =>
        (typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean") ||
        (typeof value === "number" && !Number.isFinite(value)),
    )
  ) {
    throw new TypeError(
      "Enum values must be finite strings, numbers, or booleans",
    );
  }

  const options = Object.freeze([...new Set(values)]);
  class EnumField implements FieldType<T[number]> {
    validate(value: unknown): string | undefined {
      return options.includes(value as T[number])
        ? undefined
        : `Expected one of: ${options.map(String).join(", ")}`;
    }
  }

  Object.defineProperty(EnumField, "enumValues", {
    configurable: false,
    enumerable: false,
    value: options,
    writable: false,
  });
  return EnumField;
}
