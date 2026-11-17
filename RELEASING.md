# Releasing RestFX packages

The npm packages are staged in dependency order by
[`.github/workflows/publish.yml`](.github/workflows/publish.yml). The workflow
runs when a `v*` tag is pushed, verifies that the tag matches the version of all
three packages, runs the build, typecheck, and tests, then stages `@restfx/core`,
`@restfx/server`, and `@restfx/client` in that order. Staging does not make the
versions publicly installable; a maintainer must review and approve them on npm
with 2FA.

## One-time npm setup

For each package, configure a GitHub Actions trusted publisher in its npm
package settings:

- **Organization/user:** `thinkcraft`
- **Repository:** `restfx`
- **Workflow filename:** `publish.yml`
- **Environment:** leave unset (the workflow does not use a GitHub environment)
- Allow staged publishing (`npm stage publish`). Direct `npm publish` is not
  needed by this workflow.

For an initial package that does not exist on npm yet, stage its first version
once from the package directory using a short-lived, scope-restricted npm token.
This creates npm's public `0.0.0-stage` placeholder while the real version waits
for approval. Review and approve that bootstrap version, then configure the
trusted publisher after the package exists. Do not put the bootstrap token in
the repository or commit it. The release workflow uses OIDC and does not need
an npm token secret. npm staged publishing requires npm CLI 11.15.0 or later;
the workflow installs a compatible CLI.

## Release a version

Keep the three package versions aligned. After the version changes are merged to
`main`, create and push the matching tag, for example:

```sh
git tag v0.1.1
git push origin v0.1.1
```

Pushing the tag starts the workflow. It requires a GitHub-hosted runner with
OIDC enabled and the trusted-publisher setup above. If the release version is
already staged, inspect and approve that existing stage rather than running the
workflow for the same version; npm will reject a duplicate staged version.

After the workflow succeeds, inspect the staged package names, versions, and
contents in npm's **Staged Packages** page (or with `npm stage list`,
`npm stage view <stage-id>`, and `npm stage download <stage-id>`). Approve the
packages with 2FA in dependency order: `@restfx/core`, then `@restfx/server`,
then `@restfx/client`. Approval publishes each version to npm.
