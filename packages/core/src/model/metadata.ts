import type {
  FieldOptions,
  ModelFieldMetadata,
  ModelMetadata,
  ModelOptions,
} from "./types.js";

const modelFieldsMetadata = Symbol("framework.model.fields");
const models = new WeakMap<Function, ModelMetadata>();

// TypeScript's Stage 3 decorator transform uses Symbol.metadata when creating
// the shared metadata object passed to class and member decorators.
const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
if (symbolWithMetadata.metadata === undefined) {
  Object.defineProperty(Symbol, "metadata", {
    configurable: false,
    enumerable: false,
    value: Symbol.for("Symbol.metadata"),
    writable: false,
  });
}

export function registerModel(
  model: Function,
  context: ClassDecoratorContext,
  options: ModelOptions<any>,
) {
  const contextMetadata = context.metadata as Record<PropertyKey, unknown>;
  const ownFields =
    (contextMetadata[modelFieldsMetadata] as
      Map<string, ModelFieldMetadata> | undefined) ?? new Map();
  const inherited = getModelMetadata(
    Object.getPrototypeOf(model) as Function | undefined,
  );
  const fields = new Map(inherited?.fields);
  for (const [name, field] of ownFields) fields.set(name, field);

  const mergedOptions = { ...inherited?.options, ...options };
  if (inherited?.options.schema || options.schema) {
    mergedOptions.schema = {
      ...inherited?.options.schema,
      ...options.schema,
    };
  }
  models.set(model, {
    fields,
    options: mergedOptions,
    validators: [
      ...(inherited?.validators ?? []),
      ...(options.validate ? [options.validate] : []),
    ],
  });
}

export function registerField<T>(
  options: FieldOptions<T>,
  context: ClassFieldDecoratorContext,
) {
  if (typeof context.name !== "string") {
    throw new TypeError("@Field can only decorate string-named fields");
  }

  const contextMetadata = context.metadata as Record<PropertyKey, unknown>;
  let fields = Object.hasOwn(contextMetadata, modelFieldsMetadata)
    ? (contextMetadata[modelFieldsMetadata] as
        Map<string, ModelFieldMetadata> | undefined)
    : undefined;

  if (!fields) {
    fields = new Map();
    Object.defineProperty(contextMetadata, modelFieldsMetadata, {
      configurable: false,
      enumerable: false,
      value: fields,
      writable: false,
    });
  }

  if (fields.has(context.name)) {
    throw new TypeError(`Duplicate @Field declaration for ${context.name}`);
  }
  fields.set(context.name, { ...options, name: context.name });
}

export function getModelMetadata(
  model: Function | undefined,
): ModelMetadata | undefined {
  return model === undefined ? undefined : models.get(model);
}
