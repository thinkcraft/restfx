import type { HttpContext } from "../HttpContext.js";
import {
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
import { validateModel } from "@framework/core";

/** Discovers decorated resources and dispatches contexts to matching handlers. */
export class HttpRouter {
  private readonly _routes: RadixRouter;

  constructor(rootResource: ResourceConstructor) {
    this._routes = new RadixRouter();
    for (const route of this.buildRoutes(rootResource)) {
      this._routes.add(route);
    }
  }

  async dispatch(context: HttpContext): Promise<HttpRouterResult> {
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
    const invokeHandler = async () => {
      if (match.route.bodyModel) {
        await context.req.parseBody({ model: match.route.bodyModel });
      }
      return await match.route.handler.call(match.route.resource, context);
    };
    const invokeMiddleware = async (index: number): Promise<unknown> => {
      const middleware = match.route.middlewares[index];
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

      for (const [handler, handlerMetadata] of getResourceHandlers(resource)) {
        const path = joinPaths(basePath, handlerMetadata.path);
        routes.push({
          method: handlerMetadata.method,
          path,
          specificity: getPathSpecificity(path),
          resource,
          handler,
          middlewares,
          bodyModel: handlerMetadata.bodyModel,
          responseModel: handlerMetadata.responseModel,
        });
      }

      for (const child of metadata?.children ?? []) {
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

    visit(new rootResource(), "", []);

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
