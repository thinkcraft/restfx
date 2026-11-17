# Framework

A TypeScript-first full-stack framework monorepo managed with pnpm. The
workspace currently provides shared configuration helpers, a browser fetch
client, and a Node.js HTTP server with decorator-based resources and routing.

## Requirements

- Node.js 24 or newer
- pnpm 11

## Workspace packages

- `packages/core` (`@framework/core`) — typed framework configuration via
  `defineConfig`.
- `packages/client` (`@framework/client`) — a small configurable fetch client.
- `packages/server` (`@framework/server`) — Node.js HTTP server, decorated
  resources, middleware, routing, and request-body parsing. See the
  [server README](packages/server/README.md) for usage and behavior.
- `apps/playground` — runnable example application.

## Getting started

```sh
pnpm install
pnpm dev
```

The playground listens on <http://localhost:3000>. Set `PORT` to change the
port.

## Common commands

```sh
pnpm build       # build all TypeScript projects
pnpm typecheck   # type-check all projects
pnpm test        # run workspace tests
pnpm clean       # clean TypeScript build outputs
```

The server package also includes a routing benchmark:

```sh
pnpm --filter @framework/server bench:routing
```
