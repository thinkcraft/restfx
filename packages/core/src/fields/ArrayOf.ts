import { ModelValidationError } from "../model/ModelValidationError.js";
import { getModelMetadata } from "../model/metadata.js";
import type { ModelConstructor } from "../model/types.js";
import { validateModel } from "../model/validateModel.js";
import type { FieldType, FieldTypeConstructor } from "./FieldType.js";

export function ArrayOf<T>(
  itemType: FieldTypeConstructor<T>,
): FieldTypeConstructor<T[]>;
export function ArrayOf<TModel extends ModelConstructor>(
  itemModel: TModel,
): FieldTypeConstructor<InstanceType<TModel>[]>;
export function ArrayOf<T>(
  itemType: FieldTypeConstructor<T> | ModelConstructor<T>,
): FieldTypeConstructor<T[]> {
  const itemModel = getModelMetadata(itemType)
    ? (itemType as ModelConstructor)
    : undefined;
  class ArrayField implements FieldType<T[]> {
    validate(value: unknown) {
      if (!Array.isArray(value)) return "Expected an array";

      const validator = itemModel
        ? undefined
        : new (itemType as FieldTypeConstructor<T>)();
      for (let index = 0; index < value.length; index++) {
        if (itemModel) {
          try {
            validateModel(value[index], itemModel);
          } catch (error) {
            if (!(error instanceof ModelValidationError)) throw error;
            const issue = error.issues[0];
            return `Item ${index}: ${issue?.path ? `${issue.path}: ` : ""}${issue?.message ?? "Invalid item"}`;
          }
        } else {
          const error = validator!.validate(value[index]);
          if (error !== undefined) return `Item ${index}: ${error}`;
        }
      }
      return undefined;
    }

    parse(value: unknown) {
      if (!Array.isArray(value)) throw new TypeError("Expected an array");
      if (itemModel) {
        return value.map((item) =>
          validateModel(item, itemModel as ModelConstructor<T>),
        );
      }
      const validator = new (itemType as FieldTypeConstructor<T>)();
      return value.map((item) =>
        validator.parse ? validator.parse(item) : item,
      );
    }
  }

  Object.defineProperties(ArrayField, {
    itemType: { value: itemType },
    ...(itemModel ? { itemModel: { value: itemModel } } : {}),
  });
  return ArrayField;
}
