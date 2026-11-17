import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateClient } from "../src/generate.js";

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.spec || !args.models || !args.out) {
    printHelp();
    throw new Error("--spec, --models, and --out are required");
  }

  const document = await readOpenApi(args.spec);
  const output = resolve(args.out);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    generateClient(document, { models: args.models }),
    "utf8",
  );
  console.log(`Generated API client: ${output}`);
}

function parseArguments(args: string[]) {
  const result: {
    spec?: string;
    models?: string;
    out?: string;
    help?: boolean;
  } = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (!["--spec", "--models", "--out"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[++index];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--spec") result.spec = value;
    if (argument === "--models") result.models = value;
    if (argument === "--out") result.out = value;
  }
  return result;
}

async function readOpenApi(spec: string) {
  try {
    const url = new URL(spec);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Could not fetch OpenAPI document (${response.status})`,
        );
      }
      return response.json();
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Could not fetch")) {
      throw error;
    }
  }

  const file = resolve(spec);
  const text = await readFile(pathToFileURL(file), "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`OpenAPI document is not valid JSON: ${file}`);
  }
}

function printHelp() {
  console.log(`Usage: pnpm --filter @restfx/client generate -- --spec <url-or-file> --models <module-specifier> --out <file>

Generate a thin TypeScript fetch client from the framework OpenAPI document.
The --models value is the import specifier from the generated file to the module
that exports the shared model classes (for example, ./models.js).
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
