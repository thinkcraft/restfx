export interface NestedResourceMetadata {
  readonly key: string | symbol;
  readonly path?: string;
  readonly isStatic: boolean;
}

export interface HttpHandlerMetadata {
  readonly method: string;
  readonly path?: string;
  readonly name: string | symbol;
}

export class ResourceMetadata {
  path?: string;
  readonly children: NestedResourceMetadata[] = [];
}

const resources = new WeakMap<Function, ResourceMetadata>();
const handlers = new WeakMap<Function, HttpHandlerMetadata>();

export function getOrCreateResourceMetadata(
  resource: Function,
): ResourceMetadata {
  let metadata = resources.get(resource);

  if (!metadata) {
    metadata = new ResourceMetadata();
    resources.set(resource, metadata);
  }

  return metadata;
}

export function getResourceMetadata(
  resource: Function,
): ResourceMetadata | undefined {
  return resources.get(resource);
}

export function registerHandler(
  handler: Function,
  metadata: HttpHandlerMetadata,
) {
  handlers.set(handler, metadata);
}

export function getHandlerMetadata(
  handler: Function,
): HttpHandlerMetadata | undefined {
  return handlers.get(handler);
}
