import { Field } from "@framework/core";
import type {
  FieldOptions,
  FieldTypeConstructor,
  ModelConstructor,
} from "@framework/core";
import type { HttpRequestBodyOptions } from "../openapi/types.js";
import {
  registerRequestField,
  type HttpRequestFieldSource,
} from "../request/RequestModelMetadata.js";

export type HttpRequestFieldOptions<T = unknown> = Omit<
  Extract<FieldOptions<T>, { readonly type: FieldTypeConstructor<T> }>,
  "source" | "sourceName"
> & { readonly name?: string };

export interface HttpBodyFieldOptions extends Pick<
  HttpRequestBodyOptions,
  "description" | "contentType"
> {
  readonly maxBytes?: number;
}

function sourceField(
  source: HttpRequestFieldSource,
  options: HttpRequestFieldOptions,
) {
  if (options.name !== undefined && options.name.trim() === "") {
    throw new TypeError("Request parameter name must not be empty");
  }
  const { name, ...fieldOptions } = options;
  return Field({
    ...fieldOptions,
    source,
    ...(name !== undefined ? { sourceName: name } : {}),
  });
}

/** Declares a model property populated from a matched route parameter. */
export const PathParam = (options: HttpRequestFieldOptions) =>
  sourceField("path", options);

/** Declares a model property populated from the URL query string. */
export const QueryParam = (options: HttpRequestFieldOptions) =>
  sourceField("query", options);

/** Declares a model property populated from a request header. */
export function HeaderParam(
  name: string,
  options: Omit<HttpRequestFieldOptions, "name">,
) {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
    throw new TypeError("Header parameter name must be a valid HTTP token");
  }
  return Field({ ...options, source: "header", sourceName: name });
}

/** Declares a nested, model-validated request body property. */
export function Body(
  model: ModelConstructor,
  options: HttpBodyFieldOptions = {},
) {
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
  ) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }

  const decorator = Field({
    model,
    source: "body",
    ...(options.description ? { description: options.description } : {}),
  });
  return (value: undefined, context: ClassFieldDecoratorContext) => {
    decorator(value, context);
    registerRequestField(
      {
        source: "body",
        model,
        bodyOptions: options.contentType
          ? { contentType: options.contentType }
          : {},
        ...(options.maxBytes !== undefined
          ? { bodyMaxBytes: options.maxBytes }
          : {}),
      },
      context,
    );
  };
}
