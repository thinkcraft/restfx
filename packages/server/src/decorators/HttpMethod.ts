import { registerHandler } from "../metadata/ResourceMetadata.js";
import type { ModelConstructor } from "@framework/core";

export interface HttpRouteOptions {
  readonly body?: ModelConstructor;
  readonly response?: ModelConstructor;
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
