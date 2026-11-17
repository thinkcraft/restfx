import type { ModelConstructor } from "@framework/core";
import type {
  HttpOperationOptions,
  HttpRequestBodyOptions,
  HttpResponseOptions,
} from "../openapi/types.js";

export interface Route {
  readonly method: string;
  readonly path: string;
  readonly specificity: number;
  readonly resource: object;
  readonly handler: Function;
  readonly name?: string | symbol;
  readonly middlewares: readonly RouteMiddleware[];
  readonly bodyModel?: ModelConstructor;
  readonly requestModel?: ModelConstructor;
  readonly responseModel?: ModelConstructor;
  readonly operation?: HttpOperationOptions;
  readonly requestBody?: HttpRequestBodyOptions;
  readonly responses?: Readonly<Record<string, HttpResponseOptions>>;
}

export interface RouteMiddleware {
  readonly resource: object;
  readonly handler: Function;
}
