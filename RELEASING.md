# Releasing RestFX packages

The npm packages are published in dependency order by
[`.github/workflows/publish.yml`](.github/workflows/publish.yml). The workflow
runs when a `v*` tag is pushed, verifies that the tag matches the version of all
three packages, runs the build, typecheck, and tests, then publishes `@restfx/core`,
`@restfx/server`, and `@restfx/client` in that order.

## One-time npm setup

For each package, configure a GitHub Actions trusted publisher in its npm
package settings:

- **Organization/user:** `thinkcraft`
- **Repository:** `restfx`
- **Workflow filename:** `publish.yml`
- **Environment:** leave unset (the workflow does not use a GitHub environment)
- Allow direct publishing with `npm publish` / pnpm publish.

Trusted publishing cannot create a package that does not already exist on npm.
Bootstrap-publish the initial version of each package once using a short-lived,
scope-restricted npm token, in dependency order (`core`, then `server` and
`client`). After each package exists, configure its trusted publisher. Do not
put the bootstrap token in the repository or commit it. The regular release
workflow uses OIDC and does not need an npm token secret.

## Release a version

Keep the three package versions aligned. After the version changes are merged to
`main`, create and push the matching tag, for example:

```sh
git tag v0.1.1
git push origin v0.1.1
```

Pushing the tag starts the workflow. It requires a GitHub-hosted runner with
OIDC enabled and the trusted-publisher setup above. The package name and
versions must already be available and unpublished for that version; npm will
reject duplicate versions.
