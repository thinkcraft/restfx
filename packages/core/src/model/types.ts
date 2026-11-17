import type { FieldTypeConstructor } from "../fields/FieldType.js";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ModelValidator<T = Readonly<Record<string, unknown>>> = (
  value: Readonly<T>,
) => void | ValidationIssue | readonly ValidationIssue[];

export type ModelConstructor<T = unknown> = new (...args: any[]) => T;

export type ModelFieldSource = "path" | "query" | "header" | "body";

interface FieldOptionsBase<T> {
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

export type FieldOptions<T = unknown> = FieldOptionsBase<T> &
  (
    | {
        readonly type: FieldTypeConstructor<T>;
        readonly model?: never;
        readonly source?: never;
        readonly sourceName?: never;
      }
    | {
        readonly type: FieldTypeConstructor<T>;
        readonly model?: never;
        readonly source: "path" | "query" | "header";
        /** External parameter name; defaults to the property name. */
        readonly sourceName?: string;
      }
    | {
        readonly type?: never;
        readonly model: ModelConstructor<T>;
        readonly source?: never;
        readonly sourceName?: never;
      }
    | {
        readonly type?: never;
        readonly model: ModelConstructor<T>;
        readonly source: "body";
        readonly sourceName?: never;
      }
  );

export interface ModelOptions<T = Readonly<Record<string, unknown>>> {
  /** Description of the model in generated JSON Schema and OpenAPI schemas. */
  readonly description?: string;
  /** Unknown properties are stripped by default; "reject" opts into rejection. */
  readonly unknownFields?: "reject" | "strip";
  /** Cross-field validation, run after all declared fields validate. */
  readonly validate?: ModelValidator<T>;
  /** Additional JSON Schema/OpenAPI keywords for the model object. */
  readonly schema?: Readonly<Record<string, unknown>>;
}

export interface ModelFieldMetadata extends FieldOptionsBase<unknown> {
  readonly name: string;
  readonly type?: FieldTypeConstructor;
  readonly model?: ModelConstructor;
  readonly source?: ModelFieldSource;
  readonly sourceName?: string;
}

export interface ModelMetadata {
  readonly fields: ReadonlyMap<string, ModelFieldMetadata>;
  readonly options: Readonly<ModelOptions<any>>;
  readonly validators: readonly ModelValidator<any>[];
}
