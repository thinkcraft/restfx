import { registerHandler } from "../metadata/ResourceMetadata.js";
import type { ModelConstructor } from "@framework/core";
import type {
  HttpOperationOptions,
  HttpRequestBodyOptions,
  HttpResponseOptions,
} from "../openapi/types.js";

export interface HttpRouteOptions extends HttpOperationOptions {
  readonly body?: ModelConstructor;
  readonly response?: ModelConstructor;
  readonly requestBody?: HttpRequestBodyOptions;
  readonly responses?: Readonly<Record<string, HttpResponseOptions>>;
  readonly operation?: HttpOperationOptions;
}

export function HttpMethod(
  method: string,
  path?: string,
  options: HttpRouteOptions = {},
) {
  const normalizedMethod = method.toUpperCase();

  return (value: Function, context: ClassMethodDecoratorContext) => {
    registerHandler(value, {
      method: normalizedMethod,
      path,
      name: context.name,
      bodyModel: options.body,
      responseModel: options.response,
      operation: {
        summary: options.summary,
        description: options.description,
        operationId: options.operationId,
        tags: options.tags,
        deprecated: options.deprecated,
        parameters: options.parameters,
        security: options.security,
        ...options.operation,
      },
      requestBody: options.requestBody,
      responses: options.responses,
    });
  };
}

export const HttpGet = (path?: string, options?: HttpRouteOptions) =>
  HttpMethod("GET", path, options);
export const HttpPost = (path?: string, options?: HttpRouteOptions) =>
  HttpMethod("POST", path, options);
export const HttpPut = (path?: string, options?: HttpRouteOptions) =>
  HttpMethod("PUT", path, options);
export const HttpPatch = (path?: string, options?: HttpRouteOptions) =>
  HttpMethod("PATCH", path, options);
export const HttpDelete = (path?: string, options?: HttpRouteOptions) =>
  HttpMethod("DELETE", path, options);
