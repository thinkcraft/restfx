import type { HttpContext } from "./HttpContext.js";
import {
  getHandlerMetadata,
  getResourceMetadata,
} from "./metadata/ResourceMetadata.js";

type ResourceConstructor = new () => object;

interface Route {
  readonly method: string;
  readonly path: string;
  readonly specificity: number;
  readonly resource: object;
  readonly handler: Function;
}

export type HttpRouterResult =
  | { readonly matched: true; readonly value: unknown }
  | { readonly matched: false; readonly status: 404 }
  | {
      readonly matched: false;
      readonly status: 405;
      readonly allowedMethods: readonly string[];
    };

/** Discovers decorated resources and dispatches contexts to matching handlers. */
export class HttpRouter {
  private readonly _routes: Route[];

  constructor(rootResource: ResourceConstructor) {
    this._routes = this.buildRoutes(rootResource);
  }

  async dispatch(context: HttpContext): Promise<HttpRouterResult> {
    const path = normalizePath(context.req.url.pathname);
    const method = context.req.req.method?.toUpperCase() ?? "GET";
    const matches = this._routes
      .map((candidate) => ({
        route: candidate,
        params: matchPath(candidate.path, path),
      }))
      .filter(
        (
          candidate,
        ): candidate is typeof candidate & { params: Record<string, string> } =>
          candidate.params !== undefined,
      )
      .sort((left, right) => right.route.specificity - left.route.specificity);
    const match = matches.find(
      (candidate) => candidate.route.method === method,
    );

    if (!match) {
      const allowedMethods = [
        ...new Set(matches.map(({ route }) => route.method)),
      ];

      return allowedMethods.length > 0
        ? { matched: false, status: 405, allowedMethods }
        : { matched: false, status: 404 };
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

function getResourceHandlers(resource: object) {
  const found = new Map<
    Function,
    NonNullable<ReturnType<typeof getHandlerMetadata>>
  >();
  let prototype = Object.getPrototypeOf(resource) as object | null;

  while (prototype && prototype !== Object.prototype) {
    for (const key of Reflect.ownKeys(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (typeof descriptor?.value !== "function") continue;

      const metadata = getHandlerMetadata(descriptor.value);
      if (metadata && !found.has(descriptor.value)) {
        found.set(descriptor.value, metadata);
      }
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }

  return found;
}

function isResourceObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function joinPaths(...parts: (string | undefined)[]) {
  return normalizePath(
    parts.filter((part): part is string => !!part).join("/"),
  );
}

function normalizePath(path: string) {
  const normalized = path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
  return normalized ? `/${normalized}` : "/";
}

function matchPath(routePath: string, requestPath: string) {
  const routeSegments = routePath.split("/").filter(Boolean);
  const requestSegments = requestPath.split("/").filter(Boolean);
  if (routeSegments.length !== requestSegments.length) return undefined;

  const params: Record<string, string> = {};
  for (let index = 0; index < routeSegments.length; index++) {
    const routeSegment = routeSegments[index]!;
    const requestSegment = requestSegments[index]!;

    if (routeSegment.startsWith(":")) {
      const name = routeSegment.slice(1);
      if (!name) return undefined;
      try {
        params[name] = decodeURIComponent(requestSegment);
      } catch {
        return undefined;
      }
    } else if (routeSegment !== requestSegment) {
      return undefined;
    }
  }

  return params;
}

function getPathSpecificity(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .reduce((score, segment) => score + (segment.startsWith(":") ? 0 : 1), 0);
}
