import type { FieldType } from "./FieldType.js";
import { DateField } from "./DateField.js";

const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Validates an RFC 3339 date-time represented as a string. */
export class DateTimeField implements FieldType<string> {
  validate(value: unknown): string | undefined {
    if (typeof value !== "string" || !dateTimePattern.test(value)) {
      return "Expected a valid RFC 3339 date-time";
    }
    if (new DateField().validate(value.slice(0, 10)) !== undefined) {
      return "Expected a valid RFC 3339 date-time";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Expected a valid RFC 3339 date-time"
      : undefined;
  }
}
