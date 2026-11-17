import type { FieldType } from "./FieldType.js";

export class NumberField implements FieldType<number> {
  validate(value: unknown) {
    return typeof value === "number" && Number.isFinite(value)
      ? undefined
      : "Expected a finite number";
  }
}
