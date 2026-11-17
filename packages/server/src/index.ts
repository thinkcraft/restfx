import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { FrameworkConfig } from "@framework/core";

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

/** Create a Node.js HTTP server using the framework's shared configuration. */
export function createServer(handler: RequestHandler, _config: FrameworkConfig = {}): Server {
  return createNodeServer(handler);
}
