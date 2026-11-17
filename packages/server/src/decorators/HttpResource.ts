import { getOrCreateResourceMetadata } from "../metadata/ResourceMetadata.js";

type ResourceConstructor = abstract new (...args: any[]) => object;

type ResourceDecorator = {
  <T extends ResourceConstructor>(
    value: T,
    context: ClassDecoratorContext<T>,
  ): void;
  (value: undefined, context: ClassFieldDecoratorContext): void;
};

/** Marks a class as a resource, or mounts a resource-valued field. */
export function HttpResource(path?: string): ResourceDecorator {
  return ((
    value: Function | undefined,
    context: ClassDecoratorContext | ClassFieldDecoratorContext,
  ) => {
    if (context.kind === "class") {
      getOrCreateResourceMetadata(value!).path = path;
      return;
    }

    if (context.kind !== "field") {
      throw new TypeError("@HttpResource can only decorate classes and fields");
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
