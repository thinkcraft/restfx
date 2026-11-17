import type { FieldTypeConstructor } from "../fields/FieldType.js";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ModelConstructor<T = unknown> = new (...args: any[]) => T;

export interface FieldOptions<T = unknown> {
  readonly type: FieldTypeConstructor<T>;
  /** Allows the property to be omitted. Defaults to false. */
  readonly optional?: boolean;
  /** Allows an explicit null value. Defaults to false. */
  readonly nullable?: boolean;
  /** Applied only when the property is omitted; object defaults are cloned. */
  readonly default?: T;
  /** Optional JSON Schema fragment for custom field types and formats. */
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly description?: string;
  readonly examples?: readonly T[];
  readonly deprecated?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: RegExp;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
}

export interface ModelOptions {
  /** Unknown properties are stripped by default; "reject" opts into rejection. */
  readonly unknownFields?: "reject" | "strip";
}

export interface ModelFieldMetadata extends FieldOptions {
  readonly name: string;
}

export interface ModelMetadata {
  readonly fields: ReadonlyMap<string, ModelFieldMetadata>;
  readonly options: Readonly<ModelOptions>;
}
