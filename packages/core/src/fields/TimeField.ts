import type { FieldType } from "./FieldType.js";

const timePattern =
  /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Validates an ISO 8601/RFC 3339 time represented as a string. */
export class TimeField implements FieldType<string> {
  validate(value: unknown): string | undefined {
    return typeof value === "string" && timePattern.test(value)
      ? undefined
      : "Expected a valid ISO time";
  }
}
