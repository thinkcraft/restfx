# RestFX documentation site

The documentation site is a private Astro Starlight app in the pnpm workspace.

```sh
pnpm --filter @restfx/docs dev
pnpm --filter @restfx/docs build
pnpm --filter @restfx/docs preview
```

The guides live in `src/content/docs`. The site is a static build and can be
deployed to a static host; configure the Astro `site` and `base` options if the
chosen host requires a canonical URL or a path prefix.
