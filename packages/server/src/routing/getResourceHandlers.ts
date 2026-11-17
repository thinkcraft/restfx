import { getHandlerMetadata } from "../metadata/ResourceMetadata.js";

export function getResourceHandlers(resource: object) {
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
