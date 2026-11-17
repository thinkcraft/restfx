import { type IncomingMessage, type ServerResponse } from "node:http";

export type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

export { HttpServer } from "./HttpServer.js";
export type { HttpServerOptions } from "./HttpServer.js";
export { HttpRouter } from "./routing/HttpRouter.js";
export { HttpContext } from "./HttpContext.js";
export { HttpError } from "./HttpError.js";
export { HttpRequest } from "./HttpRequest.js";
export type { HttpRequestBodyStreamOptions } from "./parsing/createRequestBodyStream.js";
export { HttpResponse } from "./HttpResponse.js";
export { HttpResult } from "./HttpResult.js";
export { HttpStatusCode } from "./HttpStatusCode.js";
export { HttpHeaderName } from "./HttpHeaderName.js";
export { HttpMediaType } from "./HttpMediaType.js";
export { HttpBodyParser } from "./parsing/HttpBodyParser.js";
export type {
  HttpMultipartData,
  HttpMultipartFile,
  HttpMultipartValue,
} from "./parsing/parseMultipartBody.js";
export { HttpResource } from "./decorators/HttpResource.js";
export { HttpMiddleware } from "./decorators/HttpMiddleware.js";
export type { HttpMiddlewareHandler } from "./metadata/ResourceMetadata.js";
export {
  HttpDelete,
  HttpGet,
  HttpMethod,
  HttpPatch,
  HttpPost,
  HttpPut,
} from "./decorators/HttpMethod.js";
export type { HttpRouteOptions } from "./decorators/HttpMethod.js";
export type { HttpParseBodyOptions } from "./HttpRequest.js";
export {
  ArrayOf,
  BooleanField,
  Email,
  Field,
  IntegerField,
  Model,
  ModelValidationError,
  NumberField,
  StringField,
  getModelMetadata,
  validateModel,
} from "@framework/core";
export type {
  FieldOptions,
  FieldType,
  FieldTypeConstructor,
  ModelConstructor,
  ModelFieldMetadata,
  ModelMetadata,
  ModelOptions,
  ValidationIssue,
} from "@framework/core";
