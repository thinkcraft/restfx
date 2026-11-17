export interface ClientOptions {
  baseUrl?: string;
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super("HTTP request failed with status " + status);
    this.name = "ApiError";
  }
}

/** Create a small typed-fetch entry point for applications built with the framework. */
export function createClient(options: ClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;

  return {
    request(path: string | URL, init?: RequestInit): Promise<Response> {
      const url = resolveUrl(path, options.baseUrl);
      const headers = new Headers(options.headers);
      new Headers(init?.headers).forEach((value, name) =>
        headers.set(name, value),
      );
      return fetcher(url, {
        ...init,
        credentials: init?.credentials ?? options.credentials,
        headers,
      });
    },
  };
}

/** Shared runtime helpers used by generated API clients. */
export function createApiClientRuntime(options: ClientOptions = {}) {
  const client = createClient(options);

  return {
    createUrl(path: string) {
      return resolveUrl(path, options.baseUrl);
    },
    appendQuery(url: URL, name: string, value: unknown) {
      if (value === undefined || value === null) return;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) url.searchParams.append(name, String(item));
    },
    copyDefinedProperties(input: object, properties: readonly string[]) {
      const result: Record<string, unknown> = {};
      for (const property of properties) {
        if (!Object.hasOwn(input, property)) continue;
        const value = Reflect.get(input, property);
        if (value !== undefined) result[property] = value;
      }
      return result;
    },
    toFormData(value: unknown) {
      if (value instanceof FormData) return value;
      if (!value || typeof value !== "object") {
        throw new TypeError(
          "multipart/form-data body must be an object or FormData",
        );
      }
      const form = new FormData();
      for (const [name, raw] of Object.entries(value)) {
        const values = Array.isArray(raw) ? raw : [raw];
        for (const item of values) {
          if (item === undefined || item === null) continue;
          if (item instanceof Blob) {
            form.append(name, item);
          } else if (typeof item === "object") {
            form.append(name, JSON.stringify(item));
          } else {
            form.append(name, String(item));
          }
        }
      }
      return form;
    },
    toUrlSearchParams(value: unknown) {
      if (value instanceof URLSearchParams) return value;
      if (!value || typeof value !== "object") {
        throw new TypeError(
          "URL-encoded body must be an object or URLSearchParams",
        );
      }
      const params = new URLSearchParams();
      for (const [name, raw] of Object.entries(value)) {
        const values = Array.isArray(raw) ? raw : [raw];
        for (const item of values) {
          if (item === undefined || item === null) continue;
          params.append(
            name,
            typeof item === "object" ? JSON.stringify(item) : String(item),
          );
        }
      }
      return params;
    },
    async sendRequest<T>(
      url: URL,
      init: RequestInit,
      fallbackContentType: string,
      emptySuccessStatuses: readonly number[],
      readBody: boolean,
    ): Promise<T> {
      const response = await client.request(url, init);
      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await readResponseBody(response);
        } catch {
          errorBody = undefined;
        }
        throw new ApiError(response.status, errorBody);
      }
      if (!readBody || emptySuccessStatuses.includes(response.status)) {
        return undefined as T;
      }
      return (await readResponseBody(response, fallbackContentType)) as T;
    },
  };
}

function resolveUrl(path: string | URL, baseUrl?: string) {
  if (path instanceof URL) return path;
  return new URL(
    path,
    baseUrl ?? globalThis.location?.origin ?? "http://localhost",
  );
}

async function readResponseBody(
  response: Response,
  fallbackContentType = "",
): Promise<unknown> {
  if (!response.body) return undefined;
  const contentType =
    (response.headers.get("content-type") ?? fallbackContentType)
      .split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    return await response.json();
  }
  if (
    contentType.startsWith("text/") ||
    contentType === "application/xml" ||
    contentType.endsWith("+xml") ||
    contentType === "application/javascript" ||
    contentType === "application/ecmascript"
  ) {
    return await response.text();
  }
  if (contentType === "application/x-www-form-urlencoded") {
    return new URLSearchParams(await response.text());
  }
  if (contentType.startsWith("multipart/form-data")) {
    return await response.formData();
  }
  return await response.blob();
}

export { generateClient } from "./generate.js";
export type { ClientGeneratorOptions } from "./generate.js";
