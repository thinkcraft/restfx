export interface ClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Create a small typed-fetch entry point for applications built with the framework. */
export function createClient(options: ClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;

  return {
    request(path: string, init?: RequestInit): Promise<Response> {
      const url = new URL(path, options.baseUrl ?? globalThis.location?.origin ?? "http://localhost");
      return fetcher(url, init);
    }
  };
}
