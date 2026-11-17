import {
  registerResourceMiddleware,
  type HttpMiddlewareHandler,
} from "../metadata/ResourceMetadata.js";

/** Applies a reusable middleware function to a resource and its subresources. */
export function HttpMiddleware(middleware: HttpMiddlewareHandler) {
  if (typeof middleware !== "function") {
    throw new TypeError("@HttpMiddleware requires a middleware function");
  }

  return (resource: Function, _context: ClassDecoratorContext) => {
    registerResourceMiddleware(resource, middleware);
  };
}
