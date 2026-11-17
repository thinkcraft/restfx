import { ModelValidationError } from "../model/ModelValidationError.js";
import { getModelMetadata } from "../model/metadata.js";
import type { ModelConstructor } from "../model/types.js";
import { validateModel } from "../model/validateModel.js";
import type { FieldType } from "./FieldType.js";

type ModelMap = Readonly<Record<string, ModelConstructor>>;
type ModelValue<T> = T extends ModelConstructor<infer TValue> ? TValue : never;

/**
 * Creates a model union selected by a string discriminator property. The map
 * keys are the allowed discriminator values and map to decorated models.
 */
export function DiscriminatedUnion<const TModels extends ModelMap>(
  discriminator: string,
  mapping: TModels,
): new () => FieldType<ModelValue<TModels[keyof TModels]>> {
  if (!discriminator.trim()) {
    throw new TypeError("DiscriminatedUnion requires a discriminator name");
  }
  if (
    mapping === null ||
    typeof mapping !== "object" ||
    Array.isArray(mapping)
  ) {
    throw new TypeError("DiscriminatedUnion requires a model mapping object");
  }
  const entries = Object.entries(mapping);
  if (entries.length < 2) {
    throw new TypeError("DiscriminatedUnion requires at least two models");
  }
  for (const [value, model] of entries) {
    if (!value || typeof model !== "function" || !getModelMetadata(model)) {
      throw new TypeError(
        "DiscriminatedUnion requires non-empty model mappings",
      );
    }
  }

  class DiscriminatedUnionField implements FieldType<
    ModelValue<TModels[keyof TModels]>
  > {
    validate(value: unknown) {
      const model = getSelectedModel(value, discriminator, mapping);
      if (!model) return `Expected a supported ${discriminator} value`;
      try {
        validateModel(value, model);
        return undefined;
      } catch (error) {
        if (!(error instanceof ModelValidationError)) throw error;
        const issue = error.issues[0];
        return issue
          ? `${issue.path ? `${issue.path}: ` : ""}${issue.message}`
          : "Invalid union value";
      }
    }

    parse(value: unknown) {
      const model = getSelectedModel(value, discriminator, mapping);
      if (!model)
        throw new TypeError(`Expected a supported ${discriminator} value`);
      return validateModel(value, model) as ModelValue<TModels[keyof TModels]>;
    }
  }

  Object.defineProperties(DiscriminatedUnionField, {
    discriminator: { value: discriminator },
    modelMapping: { value: { ...mapping } },
  });
  return DiscriminatedUnionField;
}

function getSelectedModel(
  value: unknown,
  discriminator: string,
  mapping: ModelMap,
) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const tag = (value as Record<string, unknown>)[discriminator];
  return typeof tag === "string" ? mapping[tag] : undefined;
}
