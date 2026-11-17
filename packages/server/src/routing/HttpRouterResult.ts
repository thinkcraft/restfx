import { HttpStatusCode } from "../HttpStatusCode.js";

export type HttpRouterResult =
  | { readonly matched: true; readonly value: unknown }
  | {
      readonly matched: false;
      readonly status: HttpStatusCode.NotFound;
    }
  | {
      readonly matched: false;
      readonly status: HttpStatusCode.MethodNotAllowed;
      readonly allowedMethods: readonly string[];
    };
