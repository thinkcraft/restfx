---
title: Getting started
description: Install RestFX and create a small validated HTTP API.
---

RestFX requires **Node.js 24 or newer**. The examples use TypeScript's standard
Stage 3 decorators; no legacy `experimentalDecorators` configuration is needed.

## Install

Install the shared model and server packages in your application:

```sh
pnpm add @restfx/core @restfx/server
```

## Create a resource

Define a model for validated input, then register HTTP handlers on a resource:

```ts
import { Field, Model, StringField } from "@restfx/core";
import {
  HttpContext,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpResult,
  HttpServer,
} from "@restfx/server";

@Model()
class CreatePost {
  @Field({ type: StringField, minLength: 1 })
  title!: string;
}

@HttpResource("posts")
class PostsResource {
  @HttpGet()
  list() {
    return [{ id: "1", title: "Hello" }];
  }

  @HttpPost({ body: CreatePost })
  async create(context: HttpContext) {
    const post = await context.req.parseBody<CreatePost>();
    return new HttpResult(201, { id: "2", ...post });
  }
}

@HttpResource("api")
class ApiResource {
  readonly posts = new PostsResource();
}

new HttpServer(ApiResource).listen(3000);
```

This exposes `GET /api/posts` and `POST /api/posts`. The server validates the
declared request body before calling the handler; invalid input receives a
`422` response. For a runnable application with more routes, services, and a
generated client, explore the [playground](https://github.com/thinkcraft/restfx/tree/main/apps/playground).

## Next steps

- Learn about [shared models and validation](../models/).
- Read the [server guide](../server/) for routing, middleware, and OpenAPI.
- Use the [client package](../client/) to call your API from browser code.
