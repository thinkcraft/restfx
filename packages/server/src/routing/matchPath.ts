export function matchPath(routePath: string, requestPath: string) {
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
