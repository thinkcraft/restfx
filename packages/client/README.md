# `@framework/client`

`@framework/client` contains a small fetch wrapper and an API client generator. The
generator reads the framework's OpenAPI document, reuses the model classes named
in its `x-framework-*` metadata, and emits typed operation methods. Requests
backed by framework models are validated locally before the generated method
calls `fetch`; the server must still validate every request independently.

## Generate a client

Start the API, then run the generator from the workspace:

```sh
pnpm --filter @framework/client generate -- \
  --spec http://localhost:3000/openapi.json \
  --models ./models.js \
  --out ../../apps/playground/src/api-client.ts
```

Arguments:

- `--spec`: an HTTP(S) OpenAPI URL or a local JSON file.
- `--models`: a TypeScript module specifier, relative to the generated file,
  that exports the model classes used by the API (use `.js` extensions with
  NodeNext projects).
- `--out`: the generated TypeScript file path, relative to the command's
  working directory (`packages/client` when run through the filtered command).

Generated files import `validateModel` from `@framework/core` and the fetch
wrapper from `@framework/client`. The consuming application therefore needs
those packages available at runtime. Configure the base URL and shared headers
when creating the client:

```ts
import { createApiClient } from "./api-client.js";

const api = createApiClient({
  baseUrl: "https://api.example.test",
  headers: { authorization: `Bearer ${token}` },
});

const record = await api.createRecord({ id, payload: { name: "Example" } });
```

The generator currently supports JSON request/response bodies and path, query,
and header parameters. It rejects cookie parameters and non-JSON bodies rather
than generating a client that would serialize them incorrectly. Model
validation errors are thrown before the fetch call; non-2xx HTTP responses
throw the generated `ApiError` with the status and parsed response body.
