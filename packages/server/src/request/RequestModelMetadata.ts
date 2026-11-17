import { getModelMetadata } from "@framework/core";
import type { ModelConstructor, ModelFieldSource } from "@framework/core";
import type { HttpRequestBodyOptions } from "../openapi/types.js";

const requestBodyOptionsMetadata = Symbol(
  "framework.server.requestBodyOptions",
);

export type HttpRequestFieldSource = Exclude<ModelFieldSource, "body">;

export interface HttpRequestFieldMetadata {
  readonly property: string;
  readonly source: ModelFieldSource;
  readonly name?: string;
  readonly model?: ModelConstructor;
  readonly bodyOptions?: HttpRequestBodyOptions;
  readonly bodyMaxBytes?: number;
}

export interface HttpRequestModelMetadata {
  readonly fields: readonly HttpRequestFieldMetadata[];
  readonly body?: HttpRequestFieldMetadata;
}

/** Stores server-only parser/OpenAPI options for the legacy @Body decorator. */
export function registerRequestField(
  field: Omit<HttpRequestFieldMetadata, "property">,
  context: ClassFieldDecoratorContext,
) {
  if (typeof context.name !== "string") {
    throw new TypeError("Request model decorators require string-named fields");
  }
  if (field.source !== "body") return;

  const metadata = context.metadata as Record<PropertyKey, unknown>;
  let fields = Object.hasOwn(metadata, requestBodyOptionsMetadata)
    ? (metadata[requestBodyOptionsMetadata] as Map<
        string,
        Omit<HttpRequestFieldMetadata, "property" | "source" | "model">
      >)
    : undefined;
  if (!fields) {
    fields = new Map();
    Object.defineProperty(metadata, requestBodyOptionsMetadata, {
      configurable: false,
      enumerable: false,
      value: fields,
      writable: false,
    });
  }
  fields.set(context.name, {
    ...(field.bodyOptions ? { bodyOptions: field.bodyOptions } : {}),
    ...(field.bodyMaxBytes !== undefined
      ? { bodyMaxBytes: field.bodyMaxBytes }
      : {}),
  });
}

export function getRequestModelMetadata(
  model: ModelConstructor,
): HttpRequestModelMetadata {
  const modelMetadata = getModelMetadata(model);
  if (!modelMetadata) {
    throw new TypeError(
      `${model.name || "Model"} is not decorated with @Model`,
    );
  }

  const bodyOptions = getInheritedBodyOptions(model);
  const fields: HttpRequestFieldMetadata[] = [];
  for (const [property, field] of modelMetadata.fields) {
    if (!field.source) continue;
    const extra = bodyOptions.get(property);
    const description = field.source === "body" ? field.description : undefined;
    fields.push({
      property,
      source: field.source,
      ...(field.sourceName !== undefined ? { name: field.sourceName } : {}),
      ...(field.model ? { model: field.model } : {}),
      ...(description || extra?.bodyOptions
        ? {
            bodyOptions: {
              ...(description ? { description } : {}),
              ...extra?.bodyOptions,
            },
          }
        : {}),
      ...(extra?.bodyMaxBytes !== undefined
        ? { bodyMaxBytes: extra.bodyMaxBytes }
        : {}),
    });
  }

  const bodies = fields.filter((field) => field.source === "body");
  if (bodies.length > 1) {
    throw new TypeError(
      `${model.name || "Request model"} can declare only one body field`,
    );
  }
  return {
    fields: fields.filter((field) => field.source !== "body"),
    body: bodies[0],
  };
}

function getInheritedBodyOptions(model: ModelConstructor) {
  const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
  const metadataKey = symbolWithMetadata.metadata;
  let metadata = metadataKey
    ? (model as unknown as Record<symbol, Record<PropertyKey, unknown>>)[
        metadataKey
      ]
    : undefined;
  const lineage: Record<PropertyKey, unknown>[] = [];
  while (metadata) {
    lineage.unshift(metadata);
    metadata = Object.getPrototypeOf(metadata) as
      Record<PropertyKey, unknown> | undefined;
  }

  const result = new Map<
    string,
    Omit<HttpRequestFieldMetadata, "property" | "source" | "model">
  >();
  for (const item of lineage) {
    const fields = item[requestBodyOptionsMetadata] as
      | Map<
          string,
          Omit<HttpRequestFieldMetadata, "property" | "source" | "model">
        >
      | undefined;
    if (fields)
      for (const [property, options] of fields) result.set(property, options);
  }
  return result;
}
