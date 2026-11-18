import { HttpResult, type HttpResponseBodyWriter } from "@restfx/server";

const templates = {
  greeting: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Playground template</title></head>
  <body><main><h1>Hello, {{name}}!</h1><p>Rendered with an injected template engine.</p></main></body>
</html>
`,
};

const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#x2F;",
};

export class HtmlTemplateEngine {
  render(
    name: keyof typeof templates,
    model: Readonly<Record<string, string>>,
  ): HttpResult<HttpResponseBodyWriter> {
    const template = templates[name];
    const body: HttpResponseBodyWriter = async (sink) => {
      let cursor = 0;
      const placeholders = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

      for (const match of template.matchAll(placeholders)) {
        const key = match[1];
        if (!key) continue;

        const prefix = template.slice(cursor, match.index);
        if (prefix) await sink.write(prefix);
        await sink.write(escapeHtml(model[key] ?? ""));
        cursor = match.index + match[0].length;
      }

      const suffix = template.slice(cursor);
      if (suffix) await sink.write(suffix);
    };

    return new HttpResult(200, body, {
      "content-type": "text/html; charset=utf-8",
    });
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"'\/]/g,
    (character) => htmlEscapes[character] ?? character,
  );
}
