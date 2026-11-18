import type { HttpContext } from "../HttpContext.js";
import {
  getResourceRequestMiddlewareFactories,
  getResourceMiddlewares,
  getResourceMetadata,
  type HttpMiddlewareHandler,
  type NestedResourceMetadata,
} from "../metadata/ResourceMetadata.js";
import { Route } from "./Route.js";
import { HttpRouterResult } from "./HttpRouterResult.js";
import { ResourceConstructor } from "../types/ResourceConstructor.js";
import { getResourceHandlers } from "./getResourceHandlers.js";
import { isResourceObject } from "./isResourceObject.js";
import { RadixRouter } from "./RadixRouter.js";
import { normalizePath } from "./normalizePath.js";
import { joinPaths } from "./joinPaths.js";
import { getPathSpecificity } from "./getPathSpecificity.js";
import { HttpStatusCode } from "../HttpStatusCode.js";
import { HttpResult } from "../HttpResult.js";
import { HttpHeaderName } from "../HttpHeaderName.js";
import {
  ModelValidationError,
  validateModel,
  type ValidationIssue,
} from "@restfx/core";
import { validateRequestModelRoute } from "../request/validateRequestModelRoute.js";
import { getInjectedProperties } from "../metadata/InjectionMetadata.js";

/** Discovers decorated resources and dispatches contexts to matching handlers. */
export class HttpRouter {
  private readonly _routes: RadixRouter;
  private readonly _routeDefinitions: Route[];
  private readonly _requestMiddlewares: Array<{
    readonly resource: object;
    readonly handler: HttpMiddlewareHandler;
  }> = [];
  private _rootResource!: object;
  private _rootMiddlewares: Route["middlewares"] = [];

  constructor(rootResource: ResourceConstructor) {
    this._routes = new RadixRouter();
    this._routeDefinitions = this.buildRoutes(rootResource);
    for (const route of this._routeDefinitions) {
      this._routes.add(route);
    }
    for (const createMiddleware of getResourceRequestMiddlewareFactories(
      rootResource,
    )) {
      this._requestMiddlewares.push({
        resource: this._rootResource,
        handler: createMiddleware({
          routes: this._routeDefinitions,
        }),
      });
    }
  }

  async dispatch(context: HttpContext): Promise<HttpRouterResult> {
    const rootRequestResources = new Map<object, object>();
    const rootMiddlewares = this._rootMiddlewares.map((middleware) => {
      if (getInjectedProperties(middleware.resource).length === 0) {
        return middleware;
      }

      let resource = rootRequestResources.get(middleware.resource);
      if (!resource) {
        resource = new (
          middleware.resource.constructor as ResourceConstructor
        )();
        context.container.inject(resource);
        rootRequestResources.set(middleware.resource, resource);
      }
      return { ...middleware, resource };
    });
    const middlewares = [...rootMiddlewares, ...this._requestMiddlewares];
    return invokeMiddlewareChain(
      context,
      middlewares,
      () => this.dispatchRoute(context),
      (result) => (result.matched ? result.value : undefined),
      (outcome) => {
        if (!outcome.calledNext || outcome.value !== undefined) {
          return { matched: true, value: outcome.value };
        }
        return outcome.downstream;
      },
    );
  }

  private async dispatchRoute(context: HttpContext): Promise<HttpRouterResult> {
    const path = context.req.path;
    const method = context.req.method;
    const matches = this._routes.match(path);
    const match = findRouteMatch(matches, method);

    if (!match) {
      const allowedMethods = this.getAllowedMethods(matches);

      if (method === "OPTIONS" && allowedMethods.length > 0) {
        return {
          matched: true,
          value: new HttpResult(HttpStatusCode.NoContent, undefined, {
            [HttpHeaderName.Allow]: allowedMethods.join(", "),
          }),
        };
      }

      return allowedMethods.length > 0
        ? {
            matched: false,
            status: HttpStatusCode.MethodNotAllowed,
            allowedMethods,
          }
        : { matched: false, status: HttpStatusCode.NotFound };
    }

    context.req.params = match.params;
    const resource = new (
      match.route.resource.constructor as ResourceConstructor
    )();
    context.container.inject(resource);
    const invokeHandler = async () => {
      if (match.route.requestModel) {
        await context.req.model(match.route.requestModel);
      } else if (match.route.bodyModel) {
        await context.req.parseBody({ model: match.route.bodyModel });
      }
      return await match.route.handler.call(resource, context);
    };
    const requestResources = new Map<object, object>([
      [match.route.resource, resource],
    ]);
    const routeMiddlewares = match.route.middlewares
      .slice(this._rootMiddlewares.length)
      .map((middleware) => {
        let requestResource = requestResources.get(middleware.resource);
        if (!requestResource) {
          requestResource = middleware.resource;
          if (getInjectedProperties(middleware.resource).length > 0) {
            requestResource = new (
              middleware.resource.constructor as ResourceConstructor
            )();
            context.container.inject(requestResource);
          }
          requestResources.set(middleware.resource, requestResource);
        }
        return { ...middleware, resource: requestResource };
      });
    let value = await invokeMiddlewareChain(
      context,
      routeMiddlewares,
      invokeHandler,
      (result) => result,
      (outcome) =>
        !outcome.calledNext || outcome.value !== undefined
          ? outcome.value
          : outcome.downstream,
    );
    if (match.route.responseModel) {
      if (value instanceof HttpResult) {
        if (value.body !== undefined && typeof value.body !== "function") {
          value = new HttpResult(
            value.status,
            validateResponseModel(value.body, match.route.responseModel),
            value.headers,
          );
        }
      } else if (typeof value !== "function") {
        value = validateResponseModel(value, match.route.responseModel);
      }
    }
    return { matched: true, value };
  }

  private getAllowedMethods(matches: ReturnType<RadixRouter["match"]>) {
    const allowedMethods = [
      ...new Set(matches.map(({ route }) => route.method)),
    ];
    if (allowedMethods.includes("GET") && !allowedMethods.includes("HEAD")) {
      allowedMethods.push("HEAD");
    }
    if (allowedMethods.length > 0 && !allowedMethods.includes("OPTIONS")) {
      allowedMethods.push("OPTIONS");
    }
    return allowedMethods;
  }

  private buildRoutes(rootResource: ResourceConstructor): Route[] {
    const routes: Route[] = [];
    const ancestors = new Set<object>();

    const visit = (
      resource: object,
      mountedPath: string,
      inheritedMiddlewares: Route["middlewares"],
    ) => {
      if (ancestors.has(resource)) {
        throw new TypeError("A resource cannot contain itself recursively");
      }

      ancestors.add(resource);
      const constructor = resource.constructor;
      const metadata = getResourceMetadata(constructor);
      const basePath = mountedPath || normalizePath(metadata?.path ?? "");
      const middlewares = [
        ...inheritedMiddlewares,
        ...getResourceMiddlewares(constructor).map((handler) => ({
          resource,
          handler,
        })),
      ];
      if (resource === this._rootResource) this._rootMiddlewares = middlewares;

      for (const [handler, handlerMetadata] of getResourceHandlers(resource)) {
        const path = joinPaths(basePath, handlerMetadata.path);
        if (handlerMetadata.requestModel) {
          validateRequestModelRoute(handlerMetadata.requestModel, path);
        }
        routes.push({
          method: handlerMetadata.method,
          path,
          specificity: getPathSpecificity(path),
          resource,
          handler,
          name: handlerMetadata.name,
          middlewares,
          bodyModel: handlerMetadata.bodyModel,
          requestModel: handlerMetadata.requestModel,
          responseModel: handlerMetadata.responseModel,
          operation: handlerMetadata.operation,
          requestBody: handlerMetadata.requestBody,
          responses: handlerMetadata.responses,
        });
      }

      const children = [...(metadata?.children ?? [])];
      addDecoratedChildren(
        children,
        resource as Record<PropertyKey, unknown>,
        false,
      );
      addDecoratedChildren(
        children,
        constructor as unknown as Record<PropertyKey, unknown>,
        true,
      );

      for (const child of children) {
        const owner = child.isStatic
          ? (constructor as unknown as Record<PropertyKey, unknown>)
          : (resource as Record<PropertyKey, unknown>);
        const childValue = owner[child.key];
        const childResource =
          typeof childValue === "function"
            ? new (childValue as ResourceConstructor)()
            : childValue;

        if (!isResourceObject(childResource)) {
          throw new TypeError(
            `@HttpResource field ${String(child.key)} must contain a resource instance or constructor`,
          );
        }

        const childClassPath = getResourceMetadata(
          childResource.constructor,
        )?.path;
        const childPath = child.path ?? childClassPath ?? String(child.key);
        visit(childResource, joinPaths(basePath, childPath), middlewares);
      }

      ancestors.delete(resource);
    };

    this._rootResource = new rootResource();
    visit(this._rootResource, "", []);

    const registeredRoutes = new Set<string>();
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (registeredRoutes.has(key)) {
        throw new TypeError(`Duplicate HTTP route: ${key}`);
      }
      registeredRoutes.add(key);
    }

    return routes;
  }
}

function findRouteMatch(
  matches: ReturnType<RadixRouter["match"]>,
  method: string,
) {
  if (matches.length > 1) {
    matches.sort(
      (left, right) =>
        right.route.specificity - left.route.specificity ||
        left.order - right.order,
    );
  }
  return (
    matches.find((candidate) => candidate.route.method === method) ??
    (method === "HEAD"
      ? matches.find((candidate) => candidate.route.method === "GET")
      : undefined)
  );
}

function addDecoratedChildren(
  children: NestedResourceMetadata[],
  owner: Record<PropertyKey, unknown>,
  isStatic: boolean,
) {
  for (const key of Reflect.ownKeys(owner)) {
    if (
      isExcludedStaticProperty(key, isStatic) ||
      childAlreadyRegistered(children, key, isStatic)
    ) {
      continue;
    }
    if (isDecoratedResourceProperty(owner, key))
      children.push({ key, isStatic });
  }
}

function isExcludedStaticProperty(key: PropertyKey, isStatic: boolean) {
  return (
    isStatic && (key === "prototype" || key === "name" || key === "length")
  );
}

function childAlreadyRegistered(
  children: NestedResourceMetadata[],
  key: PropertyKey,
  isStatic: boolean,
) {
  return children.some(
    (child) => child.key === key && child.isStatic === isStatic,
  );
}

function isDecoratedResourceProperty(
  owner: Record<PropertyKey, unknown>,
  key: PropertyKey,
) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor)) return false;
  const value = descriptor.value;
  const childConstructor =
    typeof value === "function"
      ? value
      : value !== null && typeof value === "object"
        ? value.constructor
        : undefined;
  return (
    typeof childConstructor === "function" &&
    Boolean(getResourceMetadata(childConstructor))
  );
}

type MiddlewareOutcome<T> =
  | { readonly calledNext: false; readonly value: unknown }
  | {
      readonly calledNext: true;
      readonly value: unknown;
      readonly downstream: T;
    };

async function invokeMiddlewareChain<T>(
  context: HttpContext,
  middlewares: readonly {
    readonly resource: object;
    readonly handler: Function;
  }[],
  terminal: () => Promise<T>,
  valueForNext: (result: T) => unknown,
  resolve: (outcome: MiddlewareOutcome<T>) => T,
): Promise<T> {
  const invoke = async (index: number): Promise<T> => {
    const middleware = middlewares[index];
    if (!middleware) return terminal();

    let downstream: Promise<T> | undefined;
    const next = () => {
      if (downstream) {
        throw new Error("HTTP middleware called next() more than once");
      }
      downstream = invoke(index + 1);
      return downstream.then(valueForNext);
    };
    const value = await (middleware.handler as HttpMiddlewareHandler).call(
      middleware.resource,
      context,
      next,
    );

    return downstream
      ? resolve({ calledNext: true, value, downstream: await downstream })
      : resolve({ calledNext: false, value });
  };

  return invoke(0);
}

function validateResponseModel(
  value: unknown,
  responseModel: NonNullable<Route["responseModel"]>,
) {
  if (typeof responseModel === "function") {
    return validateModel(value, responseModel, { unknownFields: "strip" });
  }

  if (!Array.isArray(value)) {
    throw new ModelValidationError([
      { path: "", message: "Expected an array" },
    ]);
  }

  const issues: ValidationIssue[] = [];
  const validated = value.map((item, index) => {
    try {
      return validateModel(item, responseModel.arrayOf, {
        unknownFields: "strip",
      });
    } catch (error) {
      if (!(error instanceof ModelValidationError)) throw error;
      issues.push(
        ...error.issues.map((issue) => ({
          path: issue.path ? `[${index}].${issue.path}` : `[${index}]`,
          message: issue.message,
        })),
      );
      return item;
    }
  });

  if (issues.length > 0) throw new ModelValidationError(issues);
  return validated;
}
