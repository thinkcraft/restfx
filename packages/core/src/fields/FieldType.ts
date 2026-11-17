export interface FieldType<T = unknown> {
  validate(value: unknown): string | undefined;
}

export type FieldTypeConstructor<T = unknown> = new () => FieldType<T>;
