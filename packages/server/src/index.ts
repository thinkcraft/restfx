import {
  createServer as createNodeServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { FrameworkConfig } from "@framework/core";

export type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

/** Create a Node.js HTTP server using the framework's shared configuration. */
export function createServer(
  handler: RequestHandler,
  _config: FrameworkConfig = {},
): Server {
  return createNodeServer(handler);
}

export { HttpServer } from "./HttpServer.js";
export { HttpRouter } from "./HttpRouter.js";
export { HttpContext } from "./HttpContext.js";
export { HttpError } from "./HttpError.js";
export { HttpRequest } from "./HttpRequest.js";
export { HttpResponse } from "./HttpResponse.js";
export { HttpResult } from "./HttpResult.js";
export { HttpResource } from "./decorators/HttpResource.js";
export {
  HttpDelete,
  HttpGet,
  HttpMethod,
  HttpPatch,
  HttpPost,
  HttpPut,
} from "./decorators/HttpMethod.js";
