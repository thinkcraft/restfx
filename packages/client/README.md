# `@restfx/client`

`@restfx/client` contains a small fetch wrapper and an API client generator.
It runs in environments with the standard Fetch API and does not require Node.js
APIs at runtime. The generator reads the framework's OpenAPI document, reuses
the model classes named in its `x-restfx-*` metadata, and emits typed
operation methods. Requests backed by framework models are validated locally
before the generated method calls `fetch`; the server must still validate every
request independently.

## Contents

- [Fetch wrapper](#fetch-wrapper)
- [Generate a client](#generate-a-client)
- [Supported request and response bodies](#supported-request-and-response-bodies)

## Fetch wrapper

Use `createClient()` when you want a small configurable wrapper around `fetch`
without generating operation methods. It returns the standard `Response`, so
the application chooses how to parse the body and handle status codes:

```ts
import { createClient } from "@restfx/client";

const client = createClient({
  baseUrl: "https://api.example.test/v1/",
  headers: { authorization: `Bearer ${token}` },
});

const response = await client.request("users", { method: "GET" });
if (!response.ok) throw new Error(`Request failed: ${response.status}`);
const users: unknown = await response.json();
```

`baseUrl` is optional; without it, relative paths use the browser's current
origin, or `http://localhost` in environments without `location`. Supply a
custom Fetch-compatible function with `fetch` for testing or a custom runtime.
Configured headers are combined with per-request headers, with the per-request
values taking precedence.

## Generate a client

Build the client package once, start the API, then run the generator from the
workspace:

```sh
pnpm --filter @restfx/client build
pnpm --filter @restfx/client generate -- \
  --spec http://localhost:3000/openapi.json \
  --models ./models.js \
  --out ../../apps/playground/src/api-client.ts
```

When installed as a dependency, the same generator is available as the
`restfx-client` command (or `pnpm exec restfx-client` in a pnpm project).

Arguments:

- `--spec`: an HTTP(S) OpenAPI URL or a local JSON file.
- `--models`: a TypeScript module specifier, relative to the generated file,
  that exports the model classes used by the API (use `.js` extensions with
  NodeNext projects).
- `--out`: the generated TypeScript file path, relative to the command's
  working directory (`packages/client` when run through the filtered command).

The `--models` module must export every decorated model referenced by the
document's framework metadata. Keep those imports available to the generated
module at runtime as well as to TypeScript. Regenerate the file when routes or
models change, and review generated diffs alongside the OpenAPI change.

Generated files import `validateModel` from `@restfx/core` and the fetch
wrapper from `@restfx/client`. The consuming application therefore needs
those packages available at runtime. Configure the base URL and shared headers
when creating the client:

```ts
import { createApiClient } from "./api-client.js";

const api = createApiClient({
  baseUrl: "https://api.example.test",
  headers: { authorization: `Bearer ${token}` },
});

const record = await api.records.create({ id, payload: { name: "Example" } });
```

The generated module exports `createApiClient()` and `ApiError`. `ApiError`
contains the non-success HTTP status and parsed response body; network failures
from `fetch` are passed through. Generated model-backed requests are validated
before sending, but client validation is a convenience, not a security boundary.

## Supported request and response bodies

The generator supports JSON, `multipart/form-data`,
`application/x-www-form-urlencoded`, text, and binary request and response
bodies, as well as path, query, and header parameters. Multipart and URL-encoded
object bodies are serialized from their typed properties; you can also pass
`FormData` or `URLSearchParams` directly. Multipart requests leave the
`Content-Type` header unset so `fetch` can add its boundary. Binary request
bodies accept `Blob`, `ArrayBuffer`, or `ArrayBufferView`; binary responses are
returned as `Blob`s. Text responses are returned as strings, URL-encoded
responses as `URLSearchParams`, and JSON responses are parsed as JSON. For
operations that declare more than one request media type, the generator uses
the first media type in the OpenAPI document. Model validation errors are
thrown before the fetch call; non-2xx HTTP responses throw the generated
`ApiError` with the status and parsed response body.
