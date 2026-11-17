import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://thinkcraft.github.io",
  base: process.env.DOCS_BASE ?? "/",
  integrations: [
    starlight({
      title: "RestFX",
      description:
        "TypeScript-first tools for building validated HTTP APIs and typed clients.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/thinkcraft/restfx",
        },
      ],
      sidebar: [
        {
          label: "Start here",
          items: ["getting-started"],
        },
        {
          label: "Guides",
          items: [
            "models",
            "server",
            "dependency-injection",
            "middleware",
            "request-handling",
            "openapi",
            "client",
            "operations",
          ],
        },
      ],
    }),
  ],
});
