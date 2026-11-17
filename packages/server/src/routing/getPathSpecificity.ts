export function getPathSpecificity(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .reduce((score, segment) => score + (segment.startsWith(":") ? 0 : 1), 0);
}
