import { getInjectedProperties } from "./metadata/InjectionMetadata.js";

export type HttpServiceToken<T = unknown> = string | symbol | (new () => T);

export type HttpServiceFactory<T> = (container: IocContainer) => T;

export type HttpServiceLifestyle = "singleton" | "request";

interface HttpServiceRegistration<T = unknown> {
  readonly lifestyle: HttpServiceLifestyle;
  readonly create: (container: IocContainer) => T;
}

interface IocContainerRegistry {
  readonly registrations: Map<HttpServiceToken, HttpServiceRegistration>;
  readonly singletons: Map<HttpServiceToken, unknown>;
  readonly resolving: Set<HttpServiceToken>;
}

/** A small synchronous IoC container with singleton and per-request lifetimes. */
export class IocContainer {
  private readonly _requestInstances:
    Map<HttpServiceToken, unknown> | undefined;

  constructor(
    private readonly _registry: IocContainerRegistry = {
      registrations: new Map(),
      singletons: new Map(),
      resolving: new Set(),
    },
    requestInstances?: Map<HttpServiceToken, unknown>,
  ) {
    this._requestInstances = requestInstances;
  }

  /** Register a factory. Request lifetime is the default. */
  register<T>(
    token: HttpServiceToken<T>,
    factory: HttpServiceFactory<T>,
    options: { readonly lifetime?: HttpServiceLifestyle } = {},
  ): this {
    if (this._requestInstances) {
      throw new TypeError("Services must be registered on the root container");
    }
    this._registry.registrations.set(token, {
      lifestyle: options.lifetime ?? "request",
      create: factory,
    });
    this._registry.singletons.delete(token);
    return this;
  }

  registerSingleton<T>(
    token: HttpServiceToken<T>,
    factory: HttpServiceFactory<T>,
  ): this;
  registerSingleton<T>(token: HttpServiceToken<T>, instance: T): this;
  registerSingleton<T>(
    token: HttpServiceToken<T>,
    factoryOrInstance: HttpServiceFactory<T> | T,
  ): this {
    if (typeof factoryOrInstance === "function") {
      return this.register(token, factoryOrInstance as HttpServiceFactory<T>, {
        lifetime: "singleton",
      });
    }

    return this.registerValue(token, factoryOrInstance);
  }

  /** Register an existing singleton value, including a function-valued service. */
  registerInstance<T>(token: HttpServiceToken<T>, instance: T): this {
    return this.registerValue(token, instance);
  }

  registerRequest<T>(
    token: HttpServiceToken<T>,
    factory: HttpServiceFactory<T>,
  ): this {
    return this.register(token, factory, { lifetime: "request" });
  }

  /** Resolve a registered token or an unregistered class using request lifetime. */
  get<T>(token: HttpServiceToken<T>): T {
    const registration =
      this._registry.registrations.get(token) ??
      (typeof token === "function"
        ? { lifestyle: "request" as const, create: () => new token() }
        : undefined);

    if (!registration) {
      throw new TypeError(`No service is registered for ${String(token)}`);
    }

    if (registration.lifestyle === "singleton") {
      if (this._registry.singletons.has(token)) {
        return this._registry.singletons.get(token) as T;
      }
      const value = this.create(token, registration, this.rootContainer());
      this._registry.singletons.set(token, value);
      return value as T;
    }

    if (!this._requestInstances) {
      throw new TypeError(
        `Request-scoped service ${String(token)} requires an HTTP request context`,
      );
    }
    if (this._requestInstances.has(token)) {
      return this._requestInstances.get(token) as T;
    }

    const value = this.create(token, registration, this) as T;
    this._requestInstances.set(token, value);
    return value;
  }

  /** Create an isolated request scope that shares registrations and singletons. */
  createRequestScope(): IocContainer {
    return new IocContainer(this._registry, new Map());
  }

  /** Resolve all @Inject-decorated fields on an already-created instance. */
  inject(instance: object): void {
    for (const { property, token } of getInjectedProperties(instance)) {
      Object.defineProperty(instance, property, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: this.get(token),
      });
    }
  }

  private create<T>(
    token: HttpServiceToken<T>,
    registration: HttpServiceRegistration<T>,
    resolver: IocContainer,
  ): T {
    if (this._registry.resolving.has(token)) {
      throw new TypeError(`Circular service dependency: ${String(token)}`);
    }
    this._registry.resolving.add(token);
    try {
      const value = registration.create(resolver);
      if (
        (typeof value !== "object" || value === null) &&
        typeof value !== "function"
      ) {
        return value;
      }
      resolver.inject(value as object);
      return value;
    } finally {
      this._registry.resolving.delete(token);
    }
  }

  private rootContainer(): IocContainer {
    return new IocContainer(this._registry);
  }

  private registerValue<T>(token: HttpServiceToken<T>, value: T): this {
    if (this._requestInstances) {
      throw new TypeError("Services must be registered on the root container");
    }
    this._registry.registrations.set(token, {
      lifestyle: "singleton",
      create: () => value,
    });
    this._registry.singletons.delete(token);
    return this;
  }
}
