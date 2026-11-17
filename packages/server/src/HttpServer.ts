import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { promisify } from "./utils/promisify.js";
import { HttpRequest } from "./HttpRequest.js";
import { HttpContext } from "./HttpContext.js";
import { HttpResponse } from "./HttpResponse.js";
import { HttpError } from "./HttpError.js";
import { HttpResult } from "./HttpResult.js";
import { HttpRouter } from "./HttpRouter.js";

export class HttpServer {
  private readonly _server: Server;
  private readonly _router: HttpRouter;

  constructor(rootResource: new () => object) {
    this._router = new HttpRouter(rootResource);
    this._server = createServer(this.handleRequest.bind(this));
  }

  async close() {
    await promisify(this._server.close, this._server);
  }

  listen(port = 3000) {
    return this._server.listen(port);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const context = new HttpContext(
      new HttpRequest(req),
      new HttpResponse(res),
    );

    try {
      const result = await this._router.dispatch(context);
      if (!result.matched) {
        if (result.status === 405) {
          res.setHeader("allow", result.allowedMethods.join(", "));
          res.statusCode = 405;
          res.end("Method Not Allowed");
        } else {
          res.statusCode = 404;
          res.end("Not Found");
        }
        return;
      }

      this.sendResult(res, result.value);
    } catch (error) {
      if (res.writableEnded) return;

      if (error instanceof HttpError) {
        this.sendResult(
          res,
          new HttpResult(error.status, {
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          }),
        );
        return;
      }

      this.sendResult(
        res,
        new HttpResult(500, { message: "Internal Server Error" }),
      );
    }
  }

  private sendResult(res: ServerResponse, value: unknown) {
    if (res.writableEnded) return;

    const result =
      value instanceof HttpResult ? value : new HttpResult(undefined, value);
    const body = result.body;
    res.statusCode = result.status ?? (body === undefined ? 204 : 200);

    for (const [name, headerValue] of Object.entries(result.headers ?? {})) {
      res.setHeader(name, headerValue);
    }

    if (
      body === undefined ||
      res.statusCode === 204 ||
      res.statusCode === 304
    ) {
      res.end();
    } else if (typeof body === "string" || Buffer.isBuffer(body)) {
      if (!res.hasHeader("content-type")) {
        res.setHeader("content-type", "text/plain; charset=utf-8");
      }
      res.end(body);
    } else {
      if (!res.hasHeader("content-type")) {
        res.setHeader("content-type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify(body));
    }
  }
}
