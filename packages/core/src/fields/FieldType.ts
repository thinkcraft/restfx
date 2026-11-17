export interface FieldType<T = unknown> {
  validate(value: unknown): string | undefined;
  /** Return a validated/normalized value; omitted when the input is preserved. */
  parse?(value: unknown): T;
}

export type FieldTypeConstructor<T = unknown> = new () => FieldType<T>;
