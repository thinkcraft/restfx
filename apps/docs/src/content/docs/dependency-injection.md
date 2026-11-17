---
title: Dependency injection
description: Register services and resolve singleton or request-scoped dependencies.
---

`@restfx/server` includes a small synchronous IoC container. Register services
on a root `IocContainer` and pass it to `HttpServer`. Each request gets an
isolated scope that shares registrations and singleton instances.

## Register and inject services

Use a class, string, or symbol as a service token. `@Inject(token)` injects an
instance field on resources or services:

```ts
import {
  HttpGet,
  HttpResource,
  HttpServer,
  IocContainer,
  Inject,
} from "@restfx/server";

class Clock {
  now() {
    return new Date();
  }
}

const container = new IocContainer()
  .registerSingleton(Clock, () => new Clock())
  .registerRequest("request-started-at", () => new Date());

@HttpResource("health")
class HealthResource {
  @Inject(Clock)
  clock!: Clock;

  @Inject("request-started-at")
  startedAt!: Date;

  @HttpGet()
  getHealth() {
    return { now: this.clock.now(), startedAt: this.startedAt };
  }
}

@HttpResource()
class ApiResource {
  readonly health = new HealthResource();
}

const server = new HttpServer(ApiResource, { container });
server.listen(3000);
```

The singleton `Clock` instance is shared across requests. The request-lifetime
value is created once per request scope and reused within that request. A
service can also resolve dependencies using the container passed to its
factory. Services created by the container have their own `@Inject` fields
resolved automatically.

## Lifetimes and registration

- `registerSingleton(token, factoryOrInstance)` registers a shared instance. A
  factory is called on first resolution; use `registerInstance(token, value)`
  when the service value itself is a function.
- `registerRequest(token, factory)` creates one instance per request scope.
- `register(token, factory, { lifetime: "singleton" | "request" })` selects
  the lifetime explicitly; request lifetime is the default.
- `get(classToken)` automatically constructs an unregistered class with request
  lifetime. Unregistered string and symbol tokens are errors.

Registration must happen on the root container before requests start. A request
scope is available as `context.container`; resolving a request-lifetime
registration directly from the root container throws because there is no active
request. `IocContainer` is synchronous and uses field injection, not
constructor injection. Circular factory dependencies throw an error. `@Inject`
supports instance fields, not static or JavaScript `#private` fields.

The playground demonstrates the pattern in its
[`createPlaygroundContainer`](https://github.com/thinkcraft/restfx/blob/main/apps/playground/src/services/container.ts)
factory and passes that container to `HttpServer`.
