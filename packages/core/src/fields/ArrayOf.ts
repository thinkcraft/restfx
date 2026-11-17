import type { FieldType, FieldTypeConstructor } from "./FieldType.js";

export function ArrayOf<T>(
  itemType: FieldTypeConstructor<T>,
): FieldTypeConstructor<T[]> {
  class ArrayField implements FieldType<T[]> {
    validate(value: unknown) {
      if (!Array.isArray(value)) return "Expected an array";

      const validator = new itemType();
      for (let index = 0; index < value.length; index++) {
        const error = validator.validate(value[index]);
        if (error !== undefined) return `Item ${index}: ${error}`;
      }
      return undefined;
    }

    parse(value: unknown) {
      if (!Array.isArray(value)) throw new TypeError("Expected an array");
      const validator = new itemType();
      return value.map((item) =>
        validator.parse ? validator.parse(item) : item,
      );
    }
  }

  Object.defineProperty(ArrayField, "itemType", { value: itemType });
  return ArrayField;
}
