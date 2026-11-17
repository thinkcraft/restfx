import { getOrCreateResourceMetadata } from "../metadata/ResourceMetadata.js";

type ResourceConstructor = abstract new (...args: any[]) => object;

export interface HttpResourceOptions {
  readonly path?: string;
  /** OpenAPI tag used by this resource's operations. */
  readonly tag?: string;
  /** Description for the resource's OpenAPI tag; requires `tag`. */
  readonly description?: string;
}

type ResourceDecorator = {
  <T extends ResourceConstructor>(
    value: T,
    context: ClassDecoratorContext<T>,
  ): void;
  (value: undefined, context: ClassFieldDecoratorContext): void;
};

/** Marks a class as a resource, or mounts a resource-valued field. */
export function HttpResource(
  pathOrOptions?: string | HttpResourceOptions,
): ResourceDecorator {
  const options =
    typeof pathOrOptions === "string"
      ? { path: pathOrOptions }
      : (pathOrOptions ?? {});
  if (options.description !== undefined && typeof options.tag !== "string") {
    throw new TypeError("@HttpResource description requires an OpenAPI tag");
  }
  const path = options.path;

  return ((
    value: Function | undefined,
    context: ClassDecoratorContext | ClassFieldDecoratorContext,
  ) => {
    if (context.kind === "class") {
      const metadata = getOrCreateResourceMetadata(value!);
      metadata.path = path;
      metadata.tag = options.tag;
      metadata.description = options.description;
      return;
    }

    if (context.kind !== "field") {
      throw new TypeError("@HttpResource can only decorate classes and fields");
    }
    if (options.tag !== undefined || options.description !== undefined) {
      throw new TypeError(
        "OpenAPI tag metadata can only be applied to resource classes",
      );
    }

    if (typeof context.name === "string" && context.name.startsWith("#")) {
      throw new TypeError("Private fields cannot be mounted as resources");
    }

    context.addInitializer(function (this: unknown) {
      const owner = context.static
        ? (this as Function)
        : (this as { constructor: Function }).constructor;
      const metadata = getOrCreateResourceMetadata(owner);
      const existing = metadata.children.find(
        (child) =>
          child.key === context.name && child.isStatic === context.static,
      );

      if (existing) return;

      metadata.children.push({
        key: context.name,
        path,
        isStatic: context.static,
      });
    });
  }) as ResourceDecorator;
}
