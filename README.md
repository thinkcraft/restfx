# Framework

A TypeScript-first full-stack framework monorepo managed with pnpm.

## Workspace layout

- `packages/core` — shared framework configuration and types
- `packages/server` — Node.js HTTP server integration
- `packages/client` — browser-friendly client utilities
- `apps/playground` — runnable example application

## Getting started

Requires Node.js 20+ and pnpm 11.

```sh
pnpm install
pnpm dev
```

The playground listens on <http://localhost:3000> (override the port with `PORT`).

## Common commands

```sh
pnpm build       # build all TypeScript projects
pnpm typecheck   # type-check all projects
pnpm clean       # remove TypeScript build outputs
```
