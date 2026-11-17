import type { HttpContext } from "../HttpContext.js";
import type { ModelConstructor } from "@framework/core";
import type {
  HttpOperationOptions,
  HttpResponseModel,
  HttpRequestBodyOptions,
  HttpResponseOptions,
} from "../openapi/types.js";
import type { Route } from "../routing/Route.js";

export interface NestedResourceMetadata {
  readonly key: string | symbol;
  readonly path?: string;
  readonly isStatic: boolean;
}

export interface HttpHandlerMetadata {
  readonly method: string;
  readonly path?: string;
  readonly name: string | symbol;
  readonly bodyModel?: ModelConstructor;
  readonly requestModel?: ModelConstructor;
  readonly responseModel?: HttpResponseModel;
  readonly operation?: HttpOperationOptions;
  readonly requestBody?: HttpRequestBodyOptions;
  readonly responses?: Readonly<Record<string, HttpResponseOptions>>;
}

export type HttpMiddlewareHandler = (
  context: HttpContext,
  next: () => Promise<unknown>,
) => unknown | Promise<unknown>;

export interface HttpRequestMiddlewareContext {
  readonly routes: readonly Route[];
}

export type HttpRequestMiddlewareFactory = (
  context: HttpRequestMiddlewareContext,
) => HttpMiddlewareHandler;

export class ResourceMetadata {
  path?: string;
  readonly children: NestedResourceMetadata[] = [];
}

const resources = new WeakMap<Function, ResourceMetadata>();
const handlers = new WeakMap<Function, HttpHandlerMetadata>();
const resourceMiddlewares = new WeakMap<Function, HttpMiddlewareHandler[]>();
const resourceRequestMiddlewareFactories = new WeakMap<
  Function,
  HttpRequestMiddlewareFactory[]
>();

export function registerResourceRequestMiddleware(
  resource: Function,
  factory: HttpRequestMiddlewareFactory,
) {
  let factories = resourceRequestMiddlewareFactories.get(resource);
  if (!factories) {
    factories = [];
    resourceRequestMiddlewareFactories.set(resource, factories);
  }
  factories.unshift(factory);
}

export function getResourceRequestMiddlewareFactories(resource: Function) {
  const hierarchy: Function[] = [];
  let current: Function | null = resource;
  while (current && current !== Function.prototype) {
    hierarchy.unshift(current);
    current = Object.getPrototypeOf(current) as Function | null;
  }

  return hierarchy.flatMap(
    (constructor) => resourceRequestMiddlewareFactories.get(constructor) ?? [],
  );
}

export function getOrCreateResourceMetadata(
  resource: Function,
): ResourceMetadata {
  let metadata = resources.get(resource);

  if (!metadata) {
    metadata = new ResourceMetadata();
    resources.set(resource, metadata);
  }

  return metadata;
}

export function getResourceMetadata(
  resource: Function,
): ResourceMetadata | undefined {
  return resources.get(resource);
}

export function registerHandler(
  handler: Function,
  metadata: HttpHandlerMetadata,
) {
  handlers.set(handler, metadata);
}

export function getHandlerMetadata(
  handler: Function,
): HttpHandlerMetadata | undefined {
  return handlers.get(handler);
}

export function registerResourceMiddleware(
  resource: Function,
  middleware: HttpMiddlewareHandler,
) {
  let middlewares = resourceMiddlewares.get(resource);
  if (!middlewares) {
    middlewares = [];
    resourceMiddlewares.set(resource, middlewares);
  }

  // Class decorators are applied bottom-to-top; unshift preserves source order.
  middlewares.unshift(middleware);
}

export function getResourceMiddlewares(resource: Function) {
  const hierarchy: Function[] = [];
  let current: Function | null = resource;
  while (current && current !== Function.prototype) {
    hierarchy.unshift(current);
    current = Object.getPrototypeOf(current) as Function | null;
  }

  return hierarchy.flatMap(
    (constructor) => resourceMiddlewares.get(constructor) ?? [],
  );
}
