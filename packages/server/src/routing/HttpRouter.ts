import type { HttpContext } from "../HttpContext.js";
import { getResourceMetadata } from "../metadata/ResourceMetadata.js";
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
    const path = context.req.url.pathname;
    const method = context.req.method;
    const matches = this._routes
      .match(path)
      .sort(
        (left, right) =>
          right.route.specificity - left.route.specificity ||
          left.order - right.order,
      );
    const match = matches.find(
      (candidate) => candidate.route.method === method,
    );

    if (!match) {
      const allowedMethods = [
        ...new Set(matches.map(({ route }) => route.method)),
      ];

      return allowedMethods.length > 0
        ? {
            matched: false,
            status: HttpStatusCode.MethodNotAllowed,
            allowedMethods,
          }
        : { matched: false, status: HttpStatusCode.NotFound };
    }

    context.req.params = match.params;
    const value = await match.route.handler.call(match.route.resource, context);
    return { matched: true, value };
  }

  private buildRoutes(rootResource: ResourceConstructor): Route[] {
    const routes: Route[] = [];
    const ancestors = new Set<object>();

    const visit = (resource: object, mountedPath: string) => {
      if (ancestors.has(resource)) {
        throw new TypeError("A resource cannot contain itself recursively");
      }

      ancestors.add(resource);
      const constructor = resource.constructor;
      const metadata = getResourceMetadata(constructor);
      const basePath = mountedPath || normalizePath(metadata?.path ?? "");

      for (const [handler, handlerMetadata] of getResourceHandlers(resource)) {
        const path = joinPaths(basePath, handlerMetadata.path);
        routes.push({
          method: handlerMetadata.method,
          path,
          specificity: getPathSpecificity(path),
          resource,
          handler,
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
        visit(childResource, joinPaths(basePath, childPath));
      }

      ancestors.delete(resource);
    };

    visit(new rootResource(), "");

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
