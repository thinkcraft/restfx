import type { ModelConstructor } from "@framework/core";

export type OpenApiSchema = Readonly<Record<string, unknown>>;

export interface HttpParameterOptions {
  readonly name: string;
  readonly in: "path" | "query" | "header" | "cookie";
  readonly description?: string;
  readonly required?: boolean;
  readonly deprecated?: boolean;
  readonly schema: OpenApiSchema;
}

export interface HttpRequestBodyOptions {
  readonly description?: string;
  readonly required?: boolean;
  readonly contentType?: string;
  readonly schema?: OpenApiSchema;
}

export interface HttpResponseOptions {
  readonly description: string;
  readonly model?: ModelConstructor;
  readonly contentType?: string;
  readonly schema?: OpenApiSchema;
  readonly headers?: Readonly<Record<string, unknown>>;
}

export interface HttpOperationOptions {
  readonly summary?: string;
  readonly description?: string;
  readonly operationId?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;
  readonly parameters?: readonly HttpParameterOptions[];
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
}

export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly termsOfService?: string;
  readonly contact?: Readonly<Record<string, string>>;
  readonly license?: Readonly<Record<string, string>>;
}

export interface OpenApiOptions {
  /** Endpoint path served by OpenApiMiddleware; defaults to `/openapi.json`. */
  readonly path?: string;
  /** Optional API reference UI served by OpenApiMiddleware. */
  readonly ui?: OpenApiUiOptions;
  readonly info: OpenApiInfo;
  readonly servers?: readonly Readonly<Record<string, unknown>>[];
  readonly tags?: readonly Readonly<Record<string, unknown>>[];
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
  readonly securitySchemes?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
}

export interface OpenApiUiOptions {
  /** UI implementation to serve. */
  readonly type: "scalar" | "swagger" | "redoc";
  /** UI page path; defaults to `/docs`. */
  readonly path?: string;
}

export interface OpenApiDocument extends Readonly<Record<string, unknown>> {
  readonly openapi: "3.1.0";
  readonly info: OpenApiInfo;
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
