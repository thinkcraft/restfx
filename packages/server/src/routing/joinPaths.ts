import { normalizePath } from "./normalizePath.js";

export function joinPaths(...parts: (string | undefined)[]) {
  return normalizePath(
    parts.filter((part): part is string => !!part).join("/"),
  );
}
