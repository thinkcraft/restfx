import type { HttpServiceToken } from "../IocContainer.js";
import { registerInjectedProperty } from "../metadata/InjectionMetadata.js";

/** Inject a registered label or class token into a resource or service field. */
export function Inject<T>(token: HttpServiceToken<T>) {
  return (_value: undefined, context: ClassFieldDecoratorContext) => {
    if (context.kind !== "field" || context.static) {
      throw new TypeError("@Inject can only decorate instance fields");
    }
    if (typeof context.name === "string" && context.name.startsWith("#")) {
      throw new TypeError("Private fields cannot be injected");
    }

    context.addInitializer(function (this: unknown) {
      registerInjectedProperty(
        this as object,
        context.name,
        token as HttpServiceToken,
      );
    });
  };
}
