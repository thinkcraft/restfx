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

export interface RadixRouteMatch {
  route: Route;
  order: number;
  params: Record<string, string>;
}

/** A compressed segment trie for static paths with wildcard parameter edges. */
export class RadixRouter {
  private readonly _root = createNode();
  private _nextOrder = 0;

  add(route: Route) {
    const segments = splitPath(route.path);
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
      order: this._nextOrder++,
      parameterNames: segments
        .filter((segment) => segment.startsWith(":"))
        .map((segment) => segment.slice(1)),
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
    return matches;
  }
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
