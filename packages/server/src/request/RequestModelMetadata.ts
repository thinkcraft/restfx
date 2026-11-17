import type { ModelConstructor } from "@framework/core";
import type { HttpRequestBodyOptions } from "../openapi/types.js";

const requestFieldsMetadata = Symbol("framework.server.requestFields");

export type HttpRequestFieldSource = "path" | "query" | "header";

export interface HttpRequestFieldMetadata {
  readonly property: string;
  readonly source: HttpRequestFieldSource | "body";
  readonly name?: string;
  readonly model?: ModelConstructor;
  readonly bodyOptions?: HttpRequestBodyOptions;
  readonly bodyMaxBytes?: number;
}

export type HttpRequestFieldDefinition = Omit<
  HttpRequestFieldMetadata,
  "property"
>;

export interface HttpRequestModelMetadata {
  readonly fields: readonly HttpRequestFieldMetadata[];
  readonly body?: HttpRequestFieldMetadata;
}

export function registerRequestField(
  field: HttpRequestFieldDefinition,
  context: ClassFieldDecoratorContext,
) {
  if (typeof context.name !== "string") {
    throw new TypeError("Request model decorators require string-named fields");
  }

  const metadata = context.metadata as Record<PropertyKey, unknown>;
  let fields = Object.hasOwn(metadata, requestFieldsMetadata)
    ? (metadata[requestFieldsMetadata] as Map<string, HttpRequestFieldMetadata>)
    : undefined;
  if (!fields) {
    fields = new Map();
    Object.defineProperty(metadata, requestFieldsMetadata, {
      configurable: false,
      enumerable: false,
      value: fields,
      writable: false,
    });
  }

  if (fields.has(context.name)) {
    throw new TypeError(
      `Duplicate request source decorator for ${context.name}`,
    );
  }
  fields.set(context.name, { ...field, property: context.name });
}

export function getRequestModelMetadata(
  model: ModelConstructor,
): HttpRequestModelMetadata {
  const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
  const metadataKey = symbolWithMetadata.metadata;
  let metadata = metadataKey
    ? (model as unknown as Record<symbol, Record<PropertyKey, unknown>>)[
        metadataKey
      ]
    : undefined;
  const inherited: HttpRequestFieldMetadata[] = [];
  const lineage: Record<PropertyKey, unknown>[] = [];
  while (metadata) {
    lineage.unshift(metadata);
    metadata = Object.getPrototypeOf(metadata) as
      Record<PropertyKey, unknown> | undefined;
  }
  for (const item of lineage) {
    const fields = item[requestFieldsMetadata] as
      Map<string, HttpRequestFieldMetadata> | undefined;
    if (fields) {
      for (const [property, field] of fields) {
        const existingIndex = inherited.findIndex(
          (existing) => existing.property === property,
        );
        if (existingIndex >= 0) inherited.splice(existingIndex, 1);
        inherited.push(field);
      }
    }
  }

  const bodies = inherited.filter((field) => field.source === "body");
  if (bodies.length > 1) {
    throw new TypeError(
      `${model.name || "Request model"} can declare only one @Body field`,
    );
  }
  return {
    fields: inherited.filter((field) => field.source !== "body"),
    body: bodies[0],
  };
}
