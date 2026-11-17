import type { FieldType } from "./FieldType.js";

export class BooleanField implements FieldType<boolean> {
  validate(value: unknown) {
    return typeof value === "boolean" ? undefined : "Expected a boolean";
  }
}
