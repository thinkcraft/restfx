export interface ClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

/** Create a small typed-fetch entry point for applications built with the framework. */
export function createClient(options: ClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;

  return {
    request(path: string, init?: RequestInit): Promise<Response> {
      const url = new URL(
        path,
        options.baseUrl ?? globalThis.location?.origin ?? "http://localhost",
      );
      const headers = new Headers(options.headers);
      new Headers(init?.headers).forEach((value, name) =>
        headers.set(name, value),
      );
      return fetcher(url, { ...init, headers });
    },
  };
}

export { generateClient } from "./generate.js";
export type { ClientGeneratorOptions } from "./generate.js";
