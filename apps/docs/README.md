# RestFX documentation site

The documentation site is a private Astro Starlight app in the pnpm workspace.

```sh
pnpm --filter @restfx/docs dev
pnpm --filter @restfx/docs build
pnpm --filter @restfx/docs preview
```

The guides live in `src/content/docs`. The site is a static build and can be
deployed to GitHub Pages at `https://thinkcraft.github.io/restfx/`. The
`deploy-docs.yml` workflow builds and deploys on pushes to `main`; it can also
be started manually with `pnpm docs:publish` (requires the GitHub CLI, `gh`,
authenticated with permission to run repository workflows). In repository
settings, configure **Pages → Build and deployment → Source** as **GitHub
Actions**.

The workflow sets `DOCS_BASE=/restfx` for the project-site path. For other
static hosts, set Astro's `site` and `DOCS_BASE` values to match the canonical
URL and any required path prefix.
