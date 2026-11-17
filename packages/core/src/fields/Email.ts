import { StringField } from "./StringField.js";

export class Email extends StringField {
  override validate(value: unknown) {
    const stringError = super.validate(value);
    if (stringError !== undefined) return stringError;

    const email = value as string;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Expected a valid email address";
    }
    return undefined;
  }
}
