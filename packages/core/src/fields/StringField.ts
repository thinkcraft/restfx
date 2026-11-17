import type { FieldType } from "./FieldType.js";

export class StringField implements FieldType<string> {
  validate(value: unknown): string | undefined {
    return typeof value === "string" ? undefined : "Expected a string";
  }
}
