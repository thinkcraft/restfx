import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { HttpResult } from "@restfx/server";

const viewFiles = {
  greeting: "greeting.ejs",
} as const;

type ViewName = keyof typeof viewFiles;
type ViewData = {
  greeting: Record<string, string>;
};

export class EjsTemplateEngine {
  private readonly templateCache = new Map<ViewName, Promise<string>>();
  private readonly viewsDirectory: string;

  constructor(options: { viewsDirectory?: string } = {}) {
    const defaultViewsDirectory = fileURLToPath(
      new URL("../../views/", import.meta.url),
    );
    this.viewsDirectory = resolve(
      options.viewsDirectory ?? defaultViewsDirectory,
    );
  }

  async render<View extends ViewName>(
    view: View,
    data: ViewData[View],
  ): Promise<HttpResult<string>> {
    const template = await this.loadTemplate(view);
    const html = ejs.render(template, data);

    return new HttpResult(200, html, {
      "content-type": "text/html; charset=utf-8",
    });
  }

  private loadTemplate(view: ViewName): Promise<string> {
    const cached = this.templateCache.get(view);
    if (cached) return cached;

    const template = readFile(
      join(this.viewsDirectory, viewFiles[view]),
      "utf8",
    ).catch((error: unknown) => {
      this.templateCache.delete(view);
      throw error;
    });
    this.templateCache.set(view, template);
    return template;
  }
}
