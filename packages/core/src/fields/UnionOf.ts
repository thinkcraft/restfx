import type { FieldType, FieldTypeConstructor } from "./FieldType.js";

export type FieldValue<T> =
  T extends FieldTypeConstructor<infer TValue> ? TValue : never;

/** Creates a field type that accepts values matching any supplied field type. */
export function UnionOf<const TTypes extends readonly FieldTypeConstructor[]>(
  ...types: TTypes
): FieldTypeConstructor<FieldValue<TTypes[number]>> {
  if (types.length < 2) {
    throw new TypeError("UnionOf requires at least two field types");
  }
  if (types.some((type) => typeof type?.prototype?.validate !== "function")) {
    throw new TypeError("UnionOf requires field type constructors");
  }

  class UnionField implements FieldType<FieldValue<TTypes[number]>> {
    validate(value: unknown) {
      return types.some((type) => new type().validate(value) === undefined)
        ? undefined
        : "Value does not match any allowed type";
    }

    parse(value: unknown) {
      const type = types.find(
        (candidate) => new candidate().validate(value) === undefined,
      );
      if (!type) throw new TypeError("Value does not match any allowed type");
      const field = new type();
      return (field.parse ? field.parse(value) : value) as FieldValue<
        TTypes[number]
      >;
    }
  }

  Object.defineProperty(UnionField, "unionTypes", { value: [...types] });
  return UnionField;
}
