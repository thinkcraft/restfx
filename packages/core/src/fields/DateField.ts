import type { FieldType } from "./FieldType.js";

/** Validates an ISO 8601 calendar date (`YYYY-MM-DD`) represented as a string. */
export class DateField implements FieldType<string> {
  validate(value: unknown): string | undefined {
    if (typeof value !== "string") return "Expected a string";
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return "Expected a valid ISO date (YYYY-MM-DD)";
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
      ? undefined
      : "Expected a valid ISO date (YYYY-MM-DD)";
  }
}
