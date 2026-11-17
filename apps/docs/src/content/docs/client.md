---
title: Fetch client and generation
description: Call APIs with the Fetch wrapper or generate typed methods from OpenAPI.
---

The `@restfx/client` package works with the standard Fetch API and does not
require Node.js APIs at runtime.

## Use the Fetch wrapper

Use `createClient()` to configure a base URL, shared headers, and Fetch
credentials:

```ts
import { createClient } from "@restfx/client";

const client = createClient({
  baseUrl: "https://api.example.test/v1/",
  headers: { authorization: `Bearer ${token}` },
  credentials: "include",
});

const response = await client.request("users", { method: "GET" });
if (!response.ok) throw new Error(`Request failed: ${response.status}`);
const users: unknown = await response.json();
```

The wrapper returns the standard `Response`; your application handles status
codes and parses the response body. For cross-origin browser requests with
`credentials: "include"`, configure credentialed CORS on the server and ensure
the cookies satisfy browser policies.

## Generate an API client

The generator creates typed operation methods from the server's OpenAPI
document. Build the client package and run the generator from the workspace:

```sh
pnpm --filter @restfx/client build
pnpm --filter @restfx/client generate -- \
  --spec http://localhost:3000/openapi.json \
  --models ./models.js \
  --out ../../apps/playground/src/api-client.ts
```

The `--models` module exports the decorated model classes referenced by the
OpenAPI document. Generated methods validate model-backed requests before
sending them, but the server must still validate every request independently.
Generated clients also expose `ApiError` for non-success HTTP responses.

The generated client supports path, query, and header parameters and JSON,
multipart, URL-encoded, text, and binary bodies. For a request declaring several
media types, it uses the first one in the OpenAPI document. Model validation
errors are thrown before Fetch; non-2xx responses throw `ApiError` with the
status and parsed body, while network failures pass through. Generated response
types are derived from OpenAPI; they do not add runtime response validation.

OpenAPI cookie parameters are not currently supported by the generator. Use
Fetch `credentials` for browser-managed cookies (with appropriate server CORS
and cookie settings); it does not let a browser client set an arbitrary `Cookie`
header. The generator reads RestFX model references from `x-restfx-*` metadata,
so the `--models` module must export those runtime model classes.

See the [`@restfx/client` README](https://github.com/thinkcraft/restfx/blob/main/packages/client/README.md)
for command arguments, supported request and response body types, and runtime
configuration.
