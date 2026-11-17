# Project guidance

## Project structure and boundaries

- This is a pnpm TypeScript monorepo. Use Node.js 24+ and pnpm 11.
- `packages/core` (`@framework/core`) contains browser-safe shared model,
  validation, and configuration code. Do not add Node.js or HTTP-server
  dependencies here.
- `packages/server` (`@framework/server`) owns Node HTTP behavior: resources,
  routing, middleware, request parsing, response handling, and OpenAPI
  generation. Keep transport- and parsing-specific behavior here rather than
  in core.
- `packages/client` (`@framework/client`) owns browser fetch behavior and
  OpenAPI-based client generation. Keep it usable without Node.js APIs.
- `apps/playground` is the runnable example application; use it for examples,
  not as a substitute for package-level tests.
- Shared models are declared in core and consumed by server/client tooling.
  Keep validation behavior, OpenAPI schemas, and generated client types
  consistent when changing model metadata or field types.

## TypeScript and implementation conventions

- Use strict TypeScript, ESM imports with `.js` extensions in source, and the
  repository's NodeNext project-reference setup.
- Write idiomatic, readable TypeScript that fits the surrounding code. Prefer
  clear names, small focused functions, and straightforward control flow over
  clever or overly generic abstractions.
- Avoid repetition by reusing existing helpers and patterns where they genuinely
  fit. Do not introduce indirection or shared abstractions solely to eliminate a
  small amount of duplication; keep behavior easy to follow at the call site.
- Keep types precise. Avoid `any`, unsafe casts, and non-null assertions unless
  there is a clear reason and the invariant is enforced nearby. Prefer
  `unknown` at untrusted boundaries and narrow it before use.
- Handle expected failures explicitly and preserve useful error context. Do not
  silently swallow errors except where the surrounding API deliberately
  isolates optional hooks or best-effort behavior.
- Make the smallest change that solves the request. Do not opportunistically
  refactor unrelated code or add configuration, dependencies, or APIs without a
  clear need.
- Decorators use the standard Stage 3 TypeScript decorator model. Do not rely on
  legacy `experimentalDecorators` semantics or invoke model constructors as part
  of validation.
- Preserve package boundaries and public exports: add public APIs through the
  relevant package `src/index.ts` (and sub-indexes where applicable).
- Prefer focused changes that follow nearby naming, formatting, and error
  handling patterns. Avoid adding dependencies for functionality the platform
  already provides.
- Keep HTTP parsing hardened: enforce existing limits, preserve native JSON
  parsing/serialization unless measurements justify alternatives, and use
  streaming for large raw bodies rather than buffering them.
- Treat OpenAPI and generated-client output as compatibility surfaces. Add or
  update tests for runtime behavior and corresponding schemas/types together.
- Add tests for meaningful behavior changes, including relevant boundary and
  failure cases. Keep tests deterministic and focused on observable behavior
  rather than implementation details.

## Tests and verification

- Core tests live in `packages/core/test`, server tests in `packages/server/test`,
  and client tests in `packages/client/test`. Use Node's test runner conventions
  already present in those directories.
- From the repository root, run:
  - `pnpm build` for the TypeScript project-reference build.
  - `pnpm typecheck` for workspace type-checking.
  - `pnpm test` for package tests.
- Format changed files with `pnpm exec prettier --write <files>` and verify with
  `pnpm exec prettier --check <files>`; there is no root lint script.
- Run `git diff --check` before finishing. For package-specific work, the
  corresponding package test script can be run with, for example,
  `pnpm --filter @framework/server test`.

## Documentation

- Update the root `README.md` for shared framework concepts and package-level
  documentation (such as `packages/server/README.md`) for detailed package
  behavior.
- Keep examples aligned with the actual exported API and tested behavior.
