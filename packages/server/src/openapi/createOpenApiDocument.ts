import {
  BooleanField,
  DateField,
  DateTimeField,
  Email,
  getModelMetadata,
  IntegerField,
  NumberField,
  StringField,
  TimeField,
  UUID,
} from "@framework/core";
import type { ModelConstructor, ModelFieldMetadata } from "@framework/core";
import type { Route } from "../routing/Route.js";
import { getRequestModelMetadata } from "../request/RequestModelMetadata.js";
import type {
  HttpResponseOptions,
  HttpResponseModel,
  OpenApiDocument,
  OpenApiOptions,
  OpenApiSchema,
} from "./types.js";

const supportedMethods = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

export function createOpenApiDocument(
  routes: readonly Route[],
  options: OpenApiOptions,
): OpenApiDocument {
  validateOpenApiOptions(options);

  const modelNames = createModelNames(routes);
  const paths: Record<string, Record<string, unknown>> = {};
  const operationIds = new Set<string>();
  const methodNameCounts = new Map<string, number>();
  const explicitOperationIds = new Set(
    routes
      .map((route) => route.operation?.operationId)
      .filter(
        (operationId): operationId is string => operationId !== undefined,
      ),
  );
  for (const route of routes) {
    if (route.operation?.operationId !== undefined) continue;
    const methodName = getRouteMethodName(route);
    if (methodName) {
      methodNameCounts.set(
        methodName,
        (methodNameCounts.get(methodName) ?? 0) + 1,
      );
    }
  }
  for (const route of routes) {
    const method = route.method.toLowerCase();
    if (!supportedMethods.has(method)) {
      throw new TypeError(
        `OpenAPI does not support the HTTP method ${route.method}`,
      );
    }

    const expandedPaths = expandOptionalPath(route.path);
    for (const [pathIndex, path] of expandedPaths.entries()) {
      const pathItem = (paths[path] ??= {});
      if (pathItem[method]) {
        throw new TypeError(
          `Multiple routes map to the OpenAPI operation ${method.toUpperCase()} ${path}`,
        );
      }
      const methodName = getRouteMethodName(route);
      const defaultOperationId =
        methodName &&
        methodNameCounts.get(methodName) === 1 &&
        !explicitOperationIds.has(methodName)
          ? methodName
          : undefined;
      const operation = createOperation(
        route,
        path,
        modelNames,
        options,
        defaultOperationId,
      );
      const originalOperationId = (operation as { operationId?: string })
        .operationId;
      const optionalParameter = getOptionalRouteParameterName(route.path);
      if (originalOperationId && optionalParameter) {
        operation.operationId = `${originalOperationId}${pathIndex === 0 ? "Without" : "With"}${capitalize(optionalParameter)}`;
      }
      const operationId = (operation as { operationId?: string }).operationId;
      if (operationId && operationIds.has(operationId)) {
        throw new TypeError(`Duplicate OpenAPI operationId: ${operationId}`);
      }
      if (operationId) operationIds.add(operationId);
      pathItem[method] = operation;
    }
  }

  const schemas: Record<string, OpenApiSchema> = {};
  for (const [model, name] of modelNames) {
    schemas[name] = createModelSchema(model, modelNames);
  }
  if (routes.some((route) => route.bodyModel || route.requestModel)) {
    schemas.ValidationIssue = {
      type: "object",
      required: ["path", "message"],
      properties: {
        path: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    };
    schemas.RequestValidationError = {
      type: "object",
      required: ["message", "details"],
      properties: {
        message: { type: "string" },
        details: {
          type: "array",
          items: { $ref: "#/components/schemas/ValidationIssue" },
        },
      },
      additionalProperties: false,
    };
  }
  if (routes.length > 0) {
    schemas.HttpErrorResponse = {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string" },
        details: {},
      },
    };
  }

  const document: Record<string, unknown> = {
    openapi: "3.1.0",
    info: options.info,
    paths,
  };
  if (options.servers) document.servers = options.servers;
  if (options.tags) document.tags = options.tags;
  if (options.security) document.security = options.security;

  const securitySchemes = options.securitySchemes;
  if (Object.keys(schemas).length > 0 || securitySchemes) {
    document.components = {
      ...(Object.keys(schemas).length > 0 ? { schemas } : {}),
      ...(securitySchemes ? { securitySchemes } : {}),
    };
  }

  return document as OpenApiDocument;
}

function createOperation(
  route: Route,
  path: string,
  modelNames: Map<ModelConstructor, string>,
  options: OpenApiOptions,
  defaultOperationId?: string,
) {
  const operation = route.operation ?? {};
  const inferredPathParameters = getPathParameterNames(path).map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  const parameterMap = new Map<string, Record<string, unknown>>();
  for (const parameter of inferredPathParameters) {
    parameterMap.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  for (const parameter of getRequestModelParameters(route, path, modelNames)) {
    parameterMap.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  for (const parameter of operation.parameters ?? []) {
    if (
      parameter.in === "path" &&
      !getRoutePathParameterNames(route.path).includes(parameter.name)
    ) {
      throw new TypeError(
        `Path parameter ${parameter.name} is not present in route ${route.path}`,
      );
    }
    if (
      parameter.in === "path" &&
      !getPathParameterNames(path).includes(parameter.name)
    ) {
      continue;
    }
    const key = `${parameter.in}:${parameter.name}`;
    parameterMap.set(key, {
      ...parameter,
      required: parameter.in === "path" ? true : (parameter.required ?? false),
    });
  }

  const responses: Record<string, unknown> = {};
  for (const [status, response] of Object.entries(route.responses ?? {})) {
    validateResponseStatus(status);
    responses[status] = createResponse(response, modelNames);
  }
  const successStatuses = Object.keys(responses).filter(isSuccessfulStatus);
  if (successStatuses.length === 0) {
    responses["200"] = route.responseModel
      ? modelResponse(route.responseModel, modelNames)
      : { description: "Successful response" };
  } else if (route.responseModel) {
    for (const status of successStatuses) {
      if (status === "204" || status === "304") continue;
      const response = responses[status] as Record<string, unknown>;
      if (!response.content) {
        response.content = {
          "application/json": {
            schema: {
              ...getResponseModelSchema(route.responseModel, modelNames),
            },
          },
        };
      }
    }
  }
  if ((route.bodyModel || route.requestModel) && !responses["422"]) {
    responses["422"] = {
      description: route.bodyModel
        ? "Request body failed model validation"
        : "Request failed model validation",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RequestValidationError" },
        },
      },
    };
  }
  if (getRouteBodyModel(route)) {
    for (const [status, description] of [
      ["400", "The request body is malformed"],
      ["413", "The request body is too large"],
      ["415", "The request content type is unsupported"],
    ] as const) {
      if (!responses[status]) {
        responses[status] = {
          description,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HttpErrorResponse" },
            },
          },
        };
      }
    }
  }
  if (!responses["500"]) {
    responses["500"] = {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/HttpErrorResponse" },
        },
      },
    };
  }

  const result: Record<string, unknown> = {
    ...operation,
    responses,
  };
  const requestMetadata = route.requestModel
    ? getRequestModelMetadata(route.requestModel)
    : undefined;
  const bodyField = requestMetadata?.body;
  const bodyModel = getRouteBodyModel(route);
  result["x-framework-client"] = {
    ...(route.requestModel
      ? {
          requestModel: {
            $ref: `#/components/schemas/${modelNames.get(route.requestModel)!}`,
          },
          fields: requestMetadata!.fields.map((field) => ({
            property: field.property,
            source: field.source,
            name: field.name ?? field.property,
          })),
        }
      : {}),
    ...(bodyModel
      ? {
          body: {
            property: bodyField?.property ?? "body",
            model: {
              $ref: `#/components/schemas/${modelNames.get(bodyModel)!}`,
            },
          },
        }
      : {}),
  };
  if (result.operationId === undefined && defaultOperationId)
    result.operationId = defaultOperationId;
  delete result.parameters;
  if (parameterMap.size > 0) result.parameters = [...parameterMap.values()];
  const requestBodyModel = getRouteBodyModel(route);
  const requestModelBodyOptions = route.requestModel
    ? getRequestModelMetadata(route.requestModel).body?.bodyOptions
    : undefined;
  if (requestBodyModel || route.requestBody || requestModelBodyOptions) {
    const bodyOptions = {
      ...requestModelBodyOptions,
      ...route.requestBody,
    };
    const schema =
      bodyOptions.schema ??
      (requestBodyModel
        ? { $ref: `#/components/schemas/${modelNames.get(requestBodyModel)!}` }
        : undefined);
    result.requestBody = {
      ...(bodyOptions.description
        ? { description: bodyOptions.description }
        : {}),
      required: bodyOptions.required ?? Boolean(requestBodyModel),
      content: {
        [bodyOptions.contentType ?? "application/json"]: {
          ...(schema ? { schema } : {}),
        },
      },
    };
  }
  if (operation.security === undefined && options.security !== undefined) {
    result.security = options.security;
  }
  return result;
}

function getRouteMethodName(route: Route) {
  return typeof route.name === "string" ? route.name : route.handler.name;
}

function getRouteBodyModel(route: Route) {
  if (route.bodyModel) return route.bodyModel;
  return route.requestModel
    ? getRequestModelMetadata(route.requestModel).body?.model
    : undefined;
}

function getRequestModelParameters(
  route: Route,
  path: string,
  modelNames: Map<ModelConstructor, string>,
) {
  if (!route.requestModel) return [];

  const requestModel = route.requestModel;
  const requestMetadata = getRequestModelMetadata(requestModel);
  const modelMetadata = getModelMetadata(requestModel);
  if (!modelMetadata) {
    throw new TypeError(
      `${requestModel.name || "Model"} is not decorated with @Model`,
    );
  }

  const routePathParameters = getRoutePathParameterNames(route.path);
  const pathParameters = getPathParameterNames(path);
  return requestMetadata.fields.flatMap((requestField) => {
    if (requestField.source === "body") return [];
    const name = requestField.name ?? requestField.property;
    if (requestField.source === "path" && !routePathParameters.includes(name)) {
      throw new TypeError(
        `Path parameter ${name} from ${requestModel.name || "request model"} is not present in route ${route.path}`,
      );
    }
    if (requestField.source === "path" && !pathParameters.includes(name)) {
      return [];
    }

    const field = modelMetadata.fields.get(requestField.property);
    if (!field) {
      throw new TypeError(
        `Request source field ${requestField.property} is missing @Field metadata`,
      );
    }
    return [
      {
        name,
        in: requestField.source,
        required:
          requestField.source === "path"
            ? true
            : !field.optional && field.default === undefined,
        ...(field.description ? { description: field.description } : {}),
        ...(field.deprecated ? { deprecated: true } : {}),
        schema: createFieldSchema(field, modelNames),
      },
    ];
  });
}

function modelResponse(
  model: HttpResponseModel,
  modelNames: Map<ModelConstructor, string>,
): Record<string, unknown> {
  return {
    description: "Successful response",
    content: {
      "application/json": {
        schema: getResponseModelSchema(model, modelNames),
      },
    },
  };
}

function getResponseModelSchema(
  model: HttpResponseModel,
  modelNames: Map<ModelConstructor, string>,
): Record<string, unknown> {
  if (typeof model === "function") {
    return { $ref: `#/components/schemas/${modelNames.get(model)!}` };
  }

  return {
    type: "array",
    items: {
      $ref: `#/components/schemas/${modelNames.get(model.arrayOf)!}`,
    },
  };
}

function createResponse(
  response: HttpResponseOptions,
  modelNames: Map<ModelConstructor, string>,
) {
  const result: Record<string, unknown> = { description: response.description };
  if (response.headers) result.headers = response.headers;
  const schema =
    response.schema ??
    (response.model
      ? { $ref: `#/components/schemas/${modelNames.get(response.model)!}` }
      : undefined);
  if (schema) {
    result.content = {
      [response.contentType ?? "application/json"]: { schema },
    };
  }
  return result;
}

function createModelNames(routes: readonly Route[]) {
  const models: ModelConstructor[] = [];
  const queued = new Set<ModelConstructor>();
  const addModel = (model: ModelConstructor) => {
    if (!queued.has(model)) {
      queued.add(model);
      models.push(model);
    }
  };
  for (const route of routes) {
    if (route.bodyModel) addModel(route.bodyModel);
    if (route.requestModel) {
      addModel(route.requestModel);
      const body = getRequestModelMetadata(route.requestModel).body;
      if (body?.model) addModel(body.model);
    }
    if (route.responseModel) {
      addModel(
        typeof route.responseModel === "function"
          ? route.responseModel
          : route.responseModel.arrayOf,
      );
    }
    for (const response of Object.values(route.responses ?? {})) {
      if (response.model) addModel(response.model);
    }
  }

  for (let index = 0; index < models.length; index++) {
    const metadata = getModelMetadata(models[index]!);
    if (!metadata) continue;
    for (const field of metadata.fields.values()) {
      if (field.model) addModel(field.model);
      for (const model of getModelsFromFieldType(field.type)) addModel(model);
    }
  }

  const names = new Map<ModelConstructor, string>();
  const used = new Set<string>(
    routes.length === 0
      ? []
      : [
          "HttpErrorResponse",
          ...(routes.some((route) => route.bodyModel || route.requestModel)
            ? ["ValidationIssue", "RequestValidationError"]
            : []),
        ],
  );
  for (const model of models) {
    const base = (model.name || "Model").replace(/[^A-Za-z0-9_.-]/g, "_");
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name);
    names.set(model, name);
  }
  return names;
}

function getModelsFromFieldType(type: Function | undefined) {
  const models = new Set<ModelConstructor>();
  const visited = new Set<Function>();
  const visit = (fieldType: Function | undefined) => {
    if (!fieldType || visited.has(fieldType)) return;
    visited.add(fieldType);
    const metadata = fieldType as Function & {
      readonly itemType?: Function;
      readonly itemModel?: ModelConstructor;
      readonly unionTypes?: readonly Function[];
      readonly modelMapping?: Readonly<Record<string, ModelConstructor>>;
    };
    if (metadata.itemModel) models.add(metadata.itemModel);
    for (const model of Object.values(metadata.modelMapping ?? {})) {
      models.add(model);
    }
    for (const unionType of metadata.unionTypes ?? []) visit(unionType);
    visit(metadata.itemType);
  };
  visit(type);
  return models;
}

function createModelSchema(
  model: ModelConstructor,
  modelNames: Map<ModelConstructor, string>,
): OpenApiSchema {
  const metadata = getModelMetadata(model);
  if (!metadata)
    throw new TypeError(
      `${model.name || "Model"} is not decorated with @Model`,
    );

  const properties: Record<string, OpenApiSchema> = {};
  const required: string[] = [];
  for (const [name, field] of metadata.fields) {
    properties[name] = createFieldSchema(field, modelNames);
    if (!field.optional && field.default === undefined) required.push(name);
  }

  return {
    ...metadata.options.schema,
    "x-framework-model": model.name,
    type: "object",
    ...(required.length > 0 ? { required } : {}),
    properties,
    additionalProperties: metadata.options.unknownFields !== "reject",
  };
}

function createFieldSchema(
  field: ModelFieldMetadata,
  modelNames: Map<ModelConstructor, string>,
): OpenApiSchema {
  const base = field.schema
    ? { ...field.schema }
    : field.model
      ? { $ref: `#/components/schemas/${modelNames.get(field.model)!}` }
      : field.type
        ? getFieldTypeSchema(field.type, modelNames)
        : {};

  if (field.minLength !== undefined) base.minLength = field.minLength;
  if (field.maxLength !== undefined) base.maxLength = field.maxLength;
  if (field.minimum !== undefined) base.minimum = field.minimum;
  if (field.maximum !== undefined) base.maximum = field.maximum;
  if (field.pattern !== undefined) base.pattern = field.pattern.source;
  if (field.minItems !== undefined) base.minItems = field.minItems;
  if (field.maxItems !== undefined) base.maxItems = field.maxItems;
  if (field.uniqueItems !== undefined) base.uniqueItems = field.uniqueItems;

  const annotations: Record<string, unknown> = {};
  if (field.description !== undefined)
    annotations.description = field.description;
  if (field.examples !== undefined) annotations.examples = field.examples;
  if (field.deprecated !== undefined) annotations.deprecated = field.deprecated;
  if (field.default !== undefined) annotations.default = field.default;

  if (!field.nullable) return { ...base, ...annotations };
  return { ...annotations, anyOf: [base, { type: "null" }] };
}

function getFieldTypeSchema(
  type: NonNullable<ModelFieldMetadata["type"]>,
  modelNames: Map<ModelConstructor, string>,
): Record<string, unknown> {
  const modelMapping = (
    type as typeof type & {
      readonly discriminator?: string;
      readonly modelMapping?: Readonly<Record<string, ModelConstructor>>;
    }
  ).modelMapping;
  if (modelMapping) {
    const discriminator = (
      type as typeof type & { readonly discriminator: string }
    ).discriminator;
    const mapping = Object.fromEntries(
      Object.entries(modelMapping).map(([tag, model]) => [
        tag,
        `#/components/schemas/${modelNames.get(model)!}`,
      ]),
    );
    return {
      oneOf: Object.values(mapping).map(($ref) => ({ $ref })),
      discriminator: { propertyName: discriminator, mapping },
    };
  }

  const unionTypes = (
    type as typeof type & { readonly unionTypes?: readonly (typeof type)[] }
  ).unionTypes;
  if (unionTypes) {
    return {
      anyOf: unionTypes.map((part) => getFieldTypeSchema(part, modelNames)),
    };
  }

  const enumValues = (
    type as typeof type & { readonly enumValues?: readonly unknown[] }
  ).enumValues;
  if (enumValues) {
    const valueTypes = new Set(enumValues.map((value) => typeof value));
    const schemaType =
      valueTypes.size === 1 ? primitiveEnumType(enumValues[0]) : undefined;
    return {
      ...(schemaType ? { type: schemaType } : {}),
      enum: [...enumValues],
    };
  }

  if (
    type === StringField ||
    type === Email ||
    type === DateField ||
    type === DateTimeField ||
    type === TimeField ||
    type.prototype instanceof StringField
  ) {
    const schema: Record<string, unknown> = { type: "string" };
    if (type === DateField || type.prototype instanceof DateField)
      schema.format = "date";
    if (type === DateTimeField || type.prototype instanceof DateTimeField)
      schema.format = "date-time";
    if (type === TimeField || type.prototype instanceof TimeField)
      schema.format = "time";
    if (type === Email || type.prototype instanceof Email)
      schema.format = "email";
    if (type === UUID || type.prototype instanceof UUID) schema.format = "uuid";
    return schema;
  }
  if (type === IntegerField) return { type: "integer" };
  if (type === NumberField) return { type: "number" };
  if (type === BooleanField) return { type: "boolean" };

  const itemType = (
    type as typeof type & {
      readonly itemType?: typeof type;
      readonly itemModel?: ModelConstructor;
    }
  ).itemType;
  const itemModel = (
    type as typeof type & { readonly itemModel?: ModelConstructor }
  ).itemModel;
  if (itemModel) {
    return {
      type: "array",
      items: { $ref: `#/components/schemas/${modelNames.get(itemModel)!}` },
    };
  }
  return itemType
    ? { type: "array", items: getFieldTypeSchema(itemType, modelNames) }
    : {};
}

function primitiveEnumType(value: unknown) {
  switch (typeof value) {
    case "string":
    case "boolean":
      return typeof value;
    case "number":
      return "number";
    default:
      return undefined;
  }
}

function expandOptionalPath(path: string) {
  const segments = path.split("/").filter(Boolean);
  const optionalIndex = segments.findIndex(
    (segment) => segment.startsWith(":") && segment.endsWith("?"),
  );
  if (optionalIndex < 0) return [toOpenApiPath(path)];

  const without = segments
    .filter((_, index) => index !== optionalIndex)
    .join("/");
  return [toOpenApiPath(without), toOpenApiPath(segments.join("/"))];
}

function getOptionalRouteParameterName(path: string) {
  const optionalSegment = path
    .split("/")
    .find((segment) => segment.startsWith(":") && segment.endsWith("?"));
  return optionalSegment?.slice(1, -1);
}

function capitalize(value: string) {
  return value.length === 0
    ? value
    : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function toOpenApiPath(path: string) {
  return `/${path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (
        segment.startsWith(":") &&
        (segment.endsWith("?") || segment.endsWith("*"))
      ) {
        return `{${segment.slice(1, -1)}}`;
      }
      if (segment.startsWith(":")) return `{${segment.slice(1)}}`;
      return segment;
    })
    .join("/")}`;
}

function getPathParameterNames(path: string) {
  return [...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!);
}

function getRoutePathParameterNames(path: string) {
  return path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1).replace(/[?*]$/, ""));
}

function isSuccessfulStatus(status: string) {
  return /^2\d\d$/.test(status) || status === "2XX";
}

function validateResponseStatus(status: string) {
  if (!/^(?:[1-5](?:\d{2}|XX)|default)$/.test(status)) {
    throw new TypeError(`Invalid OpenAPI response status: ${status}`);
  }
}

function validateOpenApiOptions(options: OpenApiOptions) {
  if (!options || typeof options !== "object" || !options.info) {
    throw new TypeError("OpenAPI options require an info object");
  }
  if (!options.info.title?.trim() || !options.info.version?.trim()) {
    throw new TypeError("OpenAPI info requires non-empty title and version");
  }
}
