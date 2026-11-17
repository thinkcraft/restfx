import { StringField } from "./StringField.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a canonical UUID string. */
export class UUID extends StringField {
  override validate(value: unknown) {
    const stringError = super.validate(value);
    if (stringError !== undefined) return stringError;

    return uuidPattern.test(value as string)
      ? undefined
      : "Expected a valid UUID";
  }
}
