export interface FrameworkConfig {
  /** The port used by the development server. */
  port?: number;
}

/** Preserve and type-check a framework configuration object. */
export function defineConfig<T extends FrameworkConfig>(config: T): T {
  return config;
}

export {
  Field,
  Model,
  ModelValidationError,
  getModelMetadata,
  validateModel,
} from "./model/index.js";
export type {
  FieldOptions,
  ModelConstructor,
  ModelFieldMetadata,
  ModelMetadata,
  ModelOptions,
  ValidationIssue,
} from "./model/index.js";
export {
  ArrayOf,
  BooleanField,
  Email,
  IntegerField,
  NumberField,
  StringField,
} from "./fields/index.js";
export type { FieldType, FieldTypeConstructor } from "./fields/index.js";
