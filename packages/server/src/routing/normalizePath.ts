export function normalizePath(path: string) {
  const normalized = path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
  return normalized ? `/${normalized}` : "/";
}
