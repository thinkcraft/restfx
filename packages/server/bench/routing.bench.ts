import { performance } from "node:perf_hooks";
import { RadixRouter } from "../src/routing/RadixRouter.js";
import type { Route } from "../src/routing/Route.js";
import { getPathSpecificity } from "../src/routing/getPathSpecificity.js";

interface RequestCase {
  method: string;
  path: string;
}

const routeGroupCounts = [10, 100, 500, 2_000];
const iterations = 2_000;
const samples = 3;

for (const groupCount of routeGroupCounts) {
  const routes = createRoutes(groupCount);
  const radix = new RadixRouter();
  for (const route of routes) radix.add(route);
  const requests = createRequests(groupCount, iterations);

  // Verify both implementations return the same matching route and params.
  for (const request of requests) {
    const oldResult = scanRoutes(routes, request);
    const radixResult = dispatchRadix(radix, request);
    if (JSON.stringify(oldResult) !== JSON.stringify(radixResult)) {
      throw new Error(`Routers disagree for ${request.method} ${request.path}`);
    }
  }

  // Warm both implementations before collecting samples.
  runBatch(routes, radix, requests.slice(0, 250));

  const scanTimes: number[] = [];
  const radixTimes: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const firstIsRadix = sample % 2 === 0;
    const firstStart = performance.now();
    const firstChecksum = firstIsRadix
      ? runRadixBatch(radix, requests)
      : runScanBatch(routes, requests);
    const firstElapsed = performance.now() - firstStart;

    const secondStart = performance.now();
    const secondChecksum = firstIsRadix
      ? runScanBatch(routes, requests)
      : runRadixBatch(radix, requests);
    const secondElapsed = performance.now() - secondStart;

    if (firstChecksum !== secondChecksum) {
      throw new Error("Router benchmark checksums differ");
    }

    if (firstIsRadix) {
      radixTimes.push(firstElapsed);
      scanTimes.push(secondElapsed);
    } else {
      scanTimes.push(firstElapsed);
      radixTimes.push(secondElapsed);
    }
  }

  const scanMs = median(scanTimes);
  const radixMs = median(radixTimes);
  const routeCount = routes.length;
  console.log(
    `${routeCount.toString().padStart(5)} routes | ` +
      `scan ${(scanMs / (iterations / 1_000)).toFixed(2)} ms/1k ` +
      `(${(iterations / (scanMs / 1_000)).toFixed(0)} req/s) | ` +
      `radix ${(radixMs / (iterations / 1_000)).toFixed(2)} ms/1k ` +
      `(${(iterations / (radixMs / 1_000)).toFixed(0)} req/s) | ` +
      `${(scanMs / radixMs).toFixed(2)}x faster`,
  );
}

function createRoutes(groupCount: number): Route[] {
  const routes: Route[] = [];
  const handler = () => undefined;
  const resource = {};
  const add = (method: string, path: string) => {
    routes.push({
      method,
      path,
      specificity: getPathSpecificity(path),
      resource,
      handler,
      middlewares: [],
    });
  };

  for (let index = 0; index < groupCount; index++) {
    add("GET", `/api/items/${index}`);
    add("GET", `/api/items/${index}/comments/:commentId`);
    add("POST", `/api/items/${index}`);
  }
  // Overlap with the static item routes to exercise specificity and fallback.
  add("GET", "/api/items/:itemId");
  return routes;
}

function createRequests(groupCount: number, count: number): RequestCase[] {
  return Array.from({ length: count }, (_, index) => {
    const group = (index * 37) % groupCount;
    switch (index % 4) {
      case 0:
        return { method: "GET", path: `/api/items/${group}` };
      case 1:
        return {
          method: "GET",
          path: `/api/items/${group}/comments/42`,
        };
      case 2:
        return { method: "PUT", path: `/api/items/${group}` };
      default:
        return { method: "GET", path: `/api/missing/${group}` };
    }
  });
}

function scanRoutes(routes: Route[], request: RequestCase) {
  const matches = routes
    .map((route, order) => ({
      route,
      order,
      params: matchPath(route.path, request.path),
    }))
    .filter(
      (
        candidate,
      ): candidate is typeof candidate & { params: Record<string, string> } =>
        candidate.params !== undefined,
    )
    .sort(
      (left, right) =>
        right.route.specificity - left.route.specificity ||
        left.order - right.order,
    );
  const match = matches.find(({ route }) => route.method === request.method);
  return match
    ? { path: match.route.path, params: match.params }
    : { allowed: [...new Set(matches.map(({ route }) => route.method))] };
}

function dispatchRadix(radix: RadixRouter, request: RequestCase) {
  const matches = radix
    .match(request.path)
    .sort(
      (left, right) =>
        right.route.specificity - left.route.specificity ||
        left.order - right.order,
    );
  const match = matches.find(({ route }) => route.method === request.method);
  return match
    ? { path: match.route.path, params: match.params }
    : { allowed: [...new Set(matches.map(({ route }) => route.method))] };
}

function runBatch(
  routes: Route[],
  radix: RadixRouter,
  requests: RequestCase[],
) {
  return runScanBatch(routes, requests) + runRadixBatch(radix, requests);
}

function runScanBatch(routes: Route[], requests: RequestCase[]) {
  let checksum = 0;
  for (const request of requests) {
    checksum += JSON.stringify(scanRoutes(routes, request)).length;
  }
  return checksum;
}

function runRadixBatch(radix: RadixRouter, requests: RequestCase[]) {
  let checksum = 0;
  for (const request of requests) {
    checksum += JSON.stringify(dispatchRadix(radix, request)).length;
  }
  return checksum;
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

function median(values: number[]) {
  return [...values].sort((left, right) => left - right)[
    Math.floor(values.length / 2)
  ]!;
}
