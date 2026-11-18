import { registerHandler } from "../metadata/ResourceMetadata.js";
import type { ModelConstructor } from "@restfx/core";
import type {
  HttpOperationOptions,
  HttpResponseModel,
  HttpRequestBodyOptions,
  HttpResponseOptions,
} from "../openapi/types.js";
import { validateMaxRequestBodyBytes } from "../parsing/requestBodyLimits.js";

export interface HttpRouteOptions extends HttpOperationOptions {
  readonly path?: string;
  readonly body?: ModelConstructor;
  readonly request?: ModelConstructor;
  readonly response?: HttpResponseModel;
  readonly requestBody?: HttpRequestBodyOptions;
  /** Maximum request body size in bytes for this endpoint. */
  readonly maxRequestBodyBytes?: number;
  readonly responses?: Readonly<Record<string, HttpResponseOptions>>;
  readonly operation?: HttpOperationOptions;
}

export function HttpMethod(method: string, options: HttpRouteOptions = {}) {
  if (options.maxRequestBodyBytes !== undefined) {
    validateMaxRequestBodyBytes(options.maxRequestBodyBytes);
  }
  if (options.body && options.request) {
    throw new TypeError('Use either "body" or "request", not both');
  }
  const normalizedMethod = method.toUpperCase();

  return (value: Function, context: ClassMethodDecoratorContext) => {
    registerHandler(value, {
      method: normalizedMethod,
      path: options.path,
      name: context.name,
      bodyModel: options.body,
      requestModel: options.request,
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
      maxRequestBodyBytes: options.maxRequestBodyBytes,
      responses: options.responses,
    });
  };
}

export const HttpGet = (options?: HttpRouteOptions) =>
  HttpMethod("GET", options);
export const HttpPost = (options?: HttpRouteOptions) =>
  HttpMethod("POST", options);
export const HttpPut = (options?: HttpRouteOptions) =>
  HttpMethod("PUT", options);
export const HttpPatch = (options?: HttpRouteOptions) =>
  HttpMethod("PATCH", options);
export const HttpDelete = (options?: HttpRouteOptions) =>
  HttpMethod("DELETE", options);
