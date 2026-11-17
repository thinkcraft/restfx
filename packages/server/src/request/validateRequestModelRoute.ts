import { getModelMetadata, type ModelConstructor } from "@restfx/core";
import { getRequestModelMetadata } from "./RequestModelMetadata.js";

export function validateRequestModelRoute(
  model: ModelConstructor,
  path: string,
) {
  const modelMetadata = getModelMetadata(model);
  if (!modelMetadata) {
    throw new TypeError(
      `${model.name || "Model"} is not decorated with @Model`,
    );
  }

  const requestMetadata = getRequestModelMetadata(model);
  const pathParameters = new Set(
    path
      .split("/")
      .filter((segment) => segment.startsWith(":"))
      .map((segment) => segment.slice(1).replace(/[?*]$/, "")),
  );
  const fields = requestMetadata.fields.map((requestField) => {
    const modelField = modelMetadata.fields.get(requestField.property);
    if (!modelField) {
      throw new TypeError(
        `Request source field ${requestField.property} is missing @Field metadata`,
      );
    }
    const name = requestField.name ?? requestField.property;
    if (requestField.source === "path" && !pathParameters.has(name)) {
      throw new TypeError(
        `Path parameter ${name} from ${model.name || "request model"} is not present in route ${path}`,
      );
    }
    if (
      requestField.source === "header" &&
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
    ) {
      throw new TypeError(`Header parameter ${name} is not a valid HTTP token`);
    }

    return { requestField, modelField };
  });

  if (requestMetadata.body) {
    if (
      !requestMetadata.body.model ||
      !getModelMetadata(requestMetadata.body.model)
    ) {
      throw new TypeError(
        `@Body field ${requestMetadata.body.property} must use a class decorated with @Model`,
      );
    }
  }

  return fields;
}
