import type { Route } from "./Route.js";

interface RadixNode {
  readonly staticEdges: Map<string, RadixEdge>;
  parameterChild?: RadixNode;
  readonly routes: RadixRoute[];
}

interface RadixEdge {
  segments: string[];
  child: RadixNode;
}

interface RadixRoute {
  route: Route;
  order: number;
  parameterNames: string[];
}

type RouteSegment =
  | { readonly type: "static"; readonly value: string }
  | { readonly type: "parameter"; readonly name: string }
  | { readonly type: "optional"; readonly name: string }
  | { readonly type: "wildcard"; readonly name: string };

interface PatternRoute {
  readonly route: Route;
  readonly order: number;
  readonly segments: RouteSegment[];
}

export interface RadixRouteMatch {
  route: Route;
  order: number;
  params: Record<string, string>;
}

/** A compressed segment trie for static paths with wildcard parameter edges. */
export class RadixRouter {
  private readonly _root = createNode();
  private readonly _patternRoutes: PatternRoute[] = [];
  private _nextOrder = 0;

  add(route: Route) {
    const segments = splitPath(route.path);
    const routeSegments = parseRouteSegments(segments);
    const order = this._nextOrder++;

    if (
      routeSegments.some(
        (segment) => segment.type === "optional" || segment.type === "wildcard",
      )
    ) {
      this._patternRoutes.push({ route, order, segments: routeSegments });
      return;
    }

    let node = this._root;
    let index = 0;

    while (index < segments.length) {
      const segment = segments[index]!;
      if (segment.startsWith(":")) {
        node.parameterChild ??= createNode();
        node = node.parameterChild;
        index++;
        continue;
      }

      let edge = node.staticEdges.get(segment);
      if (edge === undefined) {
        const end = nextParameterIndex(segments, index);
        edge = {
          segments: segments.slice(index, end),
          child: createNode(),
        };
        node.staticEdges.set(segment, edge);
        node = edge.child;
        index = end;
        continue;
      }

      const commonLength = getStaticCommonLength(
        edge.segments,
        segments,
        index,
      );
      if (commonLength < edge.segments.length) {
        const splitNode = createNode();
        const oldSuffix = edge.segments.slice(commonLength);
        splitNode.staticEdges.set(oldSuffix[0]!, {
          segments: oldSuffix,
          child: edge.child,
        });
        edge.segments = edge.segments.slice(0, commonLength);
        edge.child = splitNode;

        const routeEnd = nextParameterIndex(segments, index + commonLength);
        if (routeEnd > index + commonLength) {
          const newSuffix = segments.slice(index + commonLength, routeEnd);
          splitNode.staticEdges.set(newSuffix[0]!, {
            segments: newSuffix,
            child: createNode(),
          });
        }

        node = splitNode;
        index += commonLength;
        continue;
      }

      node = edge.child;
      index += commonLength;
    }

    node.routes.push({
      route,
      order,
      parameterNames: routeSegments
        .filter((segment) => segment.type === "parameter")
        .map((segment) => segment.name),
    });
  }

  match(path: string): RadixRouteMatch[] {
    const requestSegments = splitPath(path);
    const matches: RadixRouteMatch[] = [];

    const visit = (
      node: RadixNode,
      index: number,
      capturedParameters: string[],
    ) => {
      if (index === requestSegments.length) {
        for (const entry of node.routes) {
          const params: Record<string, string> = {};
          entry.parameterNames.forEach((name, parameterIndex) => {
            params[name] = capturedParameters[parameterIndex]!;
          });
          matches.push({ route: entry.route, order: entry.order, params });
        }
        return;
      }

      const requestSegment = requestSegments[index]!;
      const staticEdge = node.staticEdges.get(requestSegment);
      if (
        staticEdge !== undefined &&
        staticEdge.segments.every(
          (segment, offset) => requestSegments[index + offset] === segment,
        )
      ) {
        visit(
          staticEdge.child,
          index + staticEdge.segments.length,
          capturedParameters,
        );
      }

      if (node.parameterChild !== undefined) {
        try {
          const decodedSegment = decodeURIComponent(requestSegment);
          visit(node.parameterChild, index + 1, [
            ...capturedParameters,
            decodedSegment,
          ]);
        } catch {
          // An invalid encoded segment cannot match a parameter route.
        }
      }
    };

    visit(this._root, 0, []);

    for (const entry of this._patternRoutes) {
      const params = matchPattern(entry.segments, requestSegments);
      if (params !== undefined) {
        matches.push({ route: entry.route, order: entry.order, params });
      }
    }

    return matches;
  }
}

function parseRouteSegments(segments: string[]): RouteSegment[] {
  const names = new Set<string>();
  // noinspection UnnecessaryLocalVariableJS
  const parsed = segments.map((segment, index): RouteSegment => {
    if (!segment.startsWith(":")) return { type: "static", value: segment };

    const suffix = segment.at(-1);
    const hasSuffix = suffix === "?" || suffix === "*";
    const name = segment.slice(1, hasSuffix ? -1 : undefined);
    if (!name || name.includes("?") || name.includes("*")) {
      throw new TypeError(`Invalid route parameter: ${segment}`);
    }
    if (names.has(name)) {
      throw new TypeError(`Duplicate route parameter: ${name}`);
    }
    names.add(name);

    if (suffix === "?") {
      if (index !== segments.length - 1) {
        throw new TypeError(
          "Optional route parameters must be the final path segment",
        );
      }
      return { type: "optional", name };
    }
    if (suffix === "*") {
      if (index !== segments.length - 1) {
        throw new TypeError(
          "Wildcard route parameters must be the final path segment",
        );
      }
      return { type: "wildcard", name };
    }
    return { type: "parameter", name };
  });

  return parsed;
}

function matchPattern(
  routeSegments: RouteSegment[],
  requestSegments: string[],
): Record<string, string> | undefined {
  const params: Record<string, string> = {};

  const visit = (routeIndex: number, requestIndex: number): boolean => {
    if (routeIndex === routeSegments.length) {
      return requestIndex === requestSegments.length;
    }

    const segment = routeSegments[routeIndex]!;
    if (segment.type === "static") {
      return (
        requestSegments[requestIndex] === segment.value &&
        visit(routeIndex + 1, requestIndex + 1)
      );
    }

    if (segment.type === "wildcard") {
      try {
        params[segment.name] = requestSegments
          .slice(requestIndex)
          .map((part) => decodeURIComponent(part))
          .join("/");
        return true;
      } catch {
        return false;
      }
    }

    if (requestIndex < requestSegments.length) {
      try {
        params[segment.name] = decodeURIComponent(
          requestSegments[requestIndex]!,
        );
        if (visit(routeIndex + 1, requestIndex + 1)) return true;
      } catch {
        // Try an optional segment without consuming a request segment below.
      }
      delete params[segment.name];
    }

    return segment.type === "optional" && visit(routeIndex + 1, requestIndex);


  };

  return visit(0, 0) ? params : undefined;
}

function createNode(): RadixNode {
  return { staticEdges: new Map(), routes: [] };
}

function splitPath(path: string) {
  return path.split("/").filter(Boolean);
}

function nextParameterIndex(segments: string[], start: number) {
  let end = start;
  while (end < segments.length && !segments[end]!.startsWith(":")) end++;
  return end;
}

function getStaticCommonLength(
  edgeSegments: string[],
  routeSegments: string[],
  routeIndex: number,
) {
  let length = 0;
  while (
    length < edgeSegments.length &&
    routeIndex + length < routeSegments.length &&
    !routeSegments[routeIndex + length]!.startsWith(":") &&
    edgeSegments[length] === routeSegments[routeIndex + length]
  ) {
    length++;
  }
  return length;
}
