import type { HttpServiceToken } from "../IocContainer.js";

export interface InjectedProperty {
  readonly property: string | symbol;
  readonly token: HttpServiceToken;
}

const injectedProperties = new WeakMap<object, InjectedProperty[]>();

export function registerInjectedProperty(
  instance: object,
  property: string | symbol,
  token: HttpServiceToken,
) {
  let properties = injectedProperties.get(instance);
  if (!properties) {
    properties = [];
    injectedProperties.set(instance, properties);
  }
  properties.push({ property, token });
}

export function getInjectedProperties(instance: object) {
  return injectedProperties.get(instance) ?? [];
}
