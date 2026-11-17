import type { FieldType, FieldTypeConstructor } from "./FieldType.js";

export function ArrayOf<T>(
  itemType: FieldTypeConstructor<T>,
): FieldTypeConstructor<T[]> {
  return class ArrayField implements FieldType<T[]> {
    validate(value: unknown) {
      if (!Array.isArray(value)) return "Expected an array";

      const validator = new itemType();
      for (let index = 0; index < value.length; index++) {
        const error = validator.validate(value[index]);
        if (error !== undefined) return `Item ${index}: ${error}`;
      }
      return undefined;
    }
  };
}
