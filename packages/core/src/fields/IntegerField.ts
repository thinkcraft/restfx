import type { FieldType } from "./FieldType.js";

export class IntegerField implements FieldType<number> {
  validate(value: unknown) {
    return typeof value === "number" && Number.isSafeInteger(value)
      ? undefined
      : "Expected a safe integer";
  }
}
