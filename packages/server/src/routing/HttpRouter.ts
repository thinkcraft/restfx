import type { HttpContext } from "../HttpContext.js";
import {
  getResourceRequestMiddlewareFactories,
  getResourceMiddlewares,
  getResourceMetadata,
  type HttpMiddlewareHandler,
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
  getModelMetadata,
  validateModel,
  type ModelConstructor,
} from "@framework/core";
import { getRequestModelMetadata } from "../request/RequestModelMetadata.js";

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
    const middlewares = [...this._rootMiddlewares, ...this._requestMiddlewares];
    const invokeMiddleware = async (
      index: number,
    ): Promise<HttpRouterResult> => {
      const middleware = middlewares[index];
      if (!middleware) return this.dispatchRoute(context);

      let downstream: Promise<HttpRouterResult> | undefined;
      const next = () => {
        if (downstream) {
          throw new Error("HTTP middleware called next() more than once");
        }
        downstream = invokeMiddleware(index + 1);
        return downstream.then((result) =>
          result.matched ? result.value : undefined,
        );
      };
      const value = await (middleware.handler as HttpMiddlewareHandler).call(
        middleware.resource,
        context,
        next,
      );

      if (!downstream) return { matched: true, value };
      const downstreamResult = await downstream;
      return value === undefined ? downstreamResult : { matched: true, value };
    };

    return invokeMiddleware(0);
  }

  private async dispatchRoute(context: HttpContext): Promise<HttpRouterResult> {
    const path = context.req.path;
    const method = context.req.method;
    const matches = this._routes.match(path);
    if (matches.length > 1) {
      matches.sort(
        (left, right) =>
          right.route.specificity - left.route.specificity ||
          left.order - right.order,
      );
    }
    const match =
      matches.find((candidate) => candidate.route.method === method) ??
      (method === "HEAD"
        ? matches.find((candidate) => candidate.route.method === "GET")
        : undefined);

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
    const invokeHandler = async () => {
      if (match.route.requestModel) {
        await context.req.model(match.route.requestModel);
      } else if (match.route.bodyModel) {
        await context.req.parseBody({ model: match.route.bodyModel });
      }
      return await match.route.handler.call(resource, context);
    };
    const routeMiddlewares = match.route.middlewares
      .slice(this._rootMiddlewares.length)
      .map((middleware) =>
        middleware.resource === match.route.resource
          ? { ...middleware, resource }
          : middleware,
      );
    const invokeMiddleware = async (index: number): Promise<unknown> => {
      const middleware = routeMiddlewares[index];
      if (!middleware) return invokeHandler();

      let downstream: Promise<unknown> | undefined;
      const next = () => {
        if (downstream) {
          throw new Error("HTTP middleware called next() more than once");
        }
        downstream = invokeMiddleware(index + 1);
        return downstream;
      };
      const value = await (middleware.handler as HttpMiddlewareHandler).call(
        middleware.resource,
        context,
        next,
      );

      if (!downstream) return value;
      const downstreamValue = await downstream;
      return value === undefined ? downstreamValue : value;
    };

    let value = await invokeMiddleware(0);
    if (match.route.responseModel) {
      if (value instanceof HttpResult) {
        if (value.body !== undefined) {
          value = new HttpResult(
            value.status,
            validateModel(value.body, match.route.responseModel, {
              unknownFields: "strip",
            }),
            value.headers,
          );
        }
      } else {
        value = validateModel(value, match.route.responseModel, {
          unknownFields: "strip",
        });
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
      const addDecoratedChildren = (
        owner: Record<PropertyKey, unknown>,
        isStatic: boolean,
      ) => {
        for (const key of Reflect.ownKeys(owner)) {
          if (
            isStatic &&
            (key === "prototype" || key === "name" || key === "length")
          ) {
            continue;
          }
          if (
            children.some(
              (child) => child.key === key && child.isStatic === isStatic,
            )
          ) {
            continue;
          }
          const descriptor = Object.getOwnPropertyDescriptor(owner, key);
          if (!descriptor || !("value" in descriptor)) continue;
          const value = descriptor.value;
          const childConstructor =
            typeof value === "function"
              ? value
              : value !== null && typeof value === "object"
                ? value.constructor
                : undefined;
          if (
            typeof childConstructor !== "function" ||
            !getResourceMetadata(childConstructor)
          ) {
            continue;
          }
          children.push({ key, isStatic });
        }
      };
      addDecoratedChildren(resource as Record<PropertyKey, unknown>, false);
      addDecoratedChildren(
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

function validateRequestModelRoute(model: ModelConstructor, path: string) {
  const modelMetadata = getModelMetadata(model);
  if (!modelMetadata) {
    throw new TypeError(
      `${model.name || "Model"} is not decorated with @Model`,
    );
  }
  const requestMetadata = getRequestModelMetadata(model);
  const pathParameters = new Set(
    path
      .split("/")
      .filter((segment) => segment.startsWith(":"))
      .map((segment) => segment.slice(1).replace(/[?*]$/, "")),
  );
  for (const field of requestMetadata.fields) {
    if (!modelMetadata.fields.has(field.property)) {
      throw new TypeError(
        `Request source field ${field.property} is missing @Field metadata`,
      );
    }
    if (
      field.source === "path" &&
      !pathParameters.has(field.name ?? field.property)
    ) {
      throw new TypeError(
        `Path parameter ${field.name ?? field.property} from ${model.name || "request model"} is not present in route ${path}`,
      );
    }
    if (
      field.source === "header" &&
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(field.name ?? field.property)
    ) {
      throw new TypeError(
        `Header parameter ${field.name ?? field.property} is not a valid HTTP token`,
      );
    }
  }
  if (requestMetadata.body) {
    if (
      !requestMetadata.body.model ||
      !getModelMetadata(requestMetadata.body.model)
    ) {
      throw new TypeError(
        `@Body field ${requestMetadata.body.property} must use a class decorated with @Model`,
      );
    }
  }
}
