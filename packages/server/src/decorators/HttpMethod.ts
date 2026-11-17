import { registerHandler } from "../metadata/ResourceMetadata.js";

export function HttpMethod(method: string, path?: string) {
  const normalizedMethod = method.toUpperCase();

  return (value: Function, context: ClassMethodDecoratorContext) => {
    registerHandler(value, {
      method: normalizedMethod,
      path,
      name: context.name,
    });
  };
}

export const HttpGet = (path?: string) => HttpMethod("GET", path);
export const HttpPost = (path?: string) => HttpMethod("POST", path);
export const HttpPut = (path?: string) => HttpMethod("PUT", path);
export const HttpPatch = (path?: string) => HttpMethod("PATCH", path);
export const HttpDelete = (path?: string) => HttpMethod("DELETE", path);
