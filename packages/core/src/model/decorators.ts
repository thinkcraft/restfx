import { validateFieldOptions, validateModelOptions } from "./fieldOptions.js";
import { registerField, registerModel } from "./metadata.js";
import type { FieldOptions, ModelOptions } from "./types.js";

export function Model(options: ModelOptions = {}) {
  validateModelOptions(options);

  return (value: Function, context: ClassDecoratorContext) => {
    registerModel(value, context, options);
  };
}

export function Field<T>(options: FieldOptions<T>) {
  validateFieldOptions(options);

  return (_value: unknown, context: ClassFieldDecoratorContext) => {
    registerField(options, context);
  };
}
