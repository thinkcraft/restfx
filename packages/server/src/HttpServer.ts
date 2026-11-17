import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { HttpRequest } from "./HttpRequest.js";
import { HttpContext } from "./HttpContext.js";
import { HttpResponse } from "./HttpResponse.js";
import { HttpError } from "./HttpError.js";
import { HttpResult } from "./HttpResult.js";
import { HttpStatusCode } from "./HttpStatusCode.js";
import { HttpHeaderName } from "./HttpHeaderName.js";
import { HttpMediaType } from "./HttpMediaType.js";
import { HttpRouter } from "./routing/HttpRouter.js";

const streamClosed: unique symbol = Symbol("stream closed");

export interface HttpServerOptions {
  /**
   * Return true only when the connecting peer is a trusted reverse proxy.
   * Forwarded headers are ignored by default.
   */
  readonly trustProxy?: (remoteAddress: string | undefined) => boolean;
}

export class HttpServer {
  private readonly _server: Server;
  private readonly _router: HttpRouter;
  private readonly _trustProxy?: HttpServerOptions["trustProxy"];
  private _closePromise?: Promise<void>;

  constructor(rootResource: new () => object, options: HttpServerOptions = {}) {
    this._router = new HttpRouter(rootResource);
    this._trustProxy = options.trustProxy;
    this._server = createServer(this.handleRequest.bind(this));
  }

  close() {
    if (this._closePromise) return this._closePromise;
    if (!this._server.listening) return Promise.resolve();

    this._closePromise = new Promise<void>((resolve, reject) => {
      try {
        this._server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
    return this._closePromise;
  }

  listen(port = 3000) {
    this._closePromise = undefined;
    return this._server.listen(port);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    try {
      const context = new HttpContext(
        new HttpRequest(
          req,
          this._trustProxy?.(req.socket.remoteAddress) ?? false,
        ),
        new HttpResponse(res),
      );
      const result = await this._router.dispatch(context);
      if (!result.matched) {
        if (result.status === HttpStatusCode.MethodNotAllowed) {
          res.setHeader(HttpHeaderName.Allow, result.allowedMethods.join(", "));
          await this.sendResult(
            res,
            new HttpResult(
              HttpStatusCode.MethodNotAllowed,
              "Method Not Allowed",
            ),
            req.method === "HEAD",
          );
        } else {
          await this.sendResult(
            res,
            new HttpResult(HttpStatusCode.NotFound, "Not Found"),
            req.method === "HEAD",
          );
        }
        return;
      }

      await this.sendResult(res, result.value, req.method === "HEAD");
    } catch (error) {
      if (res.writableEnded) return;
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }

      if (error instanceof HttpError) {
        this.closeIncompleteRequest(req, res);
        await this.sendResult(
          res,
          new HttpResult(error.status, {
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          }),
          req.method === "HEAD",
        );
        return;
      }

      this.closeIncompleteRequest(req, res);
      await this.sendResult(
        res,
        new HttpResult(HttpStatusCode.InternalServerError, {
          message: "Internal Server Error",
        }),
        req.method === "HEAD",
      );
    }
  }

  private closeIncompleteRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.complete || res.headersSent) return;
    req.pause();
    res.shouldKeepAlive = false;
    res.setHeader("connection", "close");
  }

  private async sendResult(
    res: ServerResponse,
    value: unknown,
    headRequest = false,
  ) {
    if (res.writableEnded) return;

    const result =
      value instanceof HttpResult ? value : new HttpResult(undefined, value);
    const body = result.body;
    res.statusCode =
      result.status ??
      (body === undefined ? HttpStatusCode.NoContent : HttpStatusCode.Ok);

    for (const [name, headerValue] of Object.entries(result.headers ?? {})) {
      res.setHeader(name, headerValue);
    }

    if (
      body === undefined ||
      res.statusCode === HttpStatusCode.NoContent ||
      res.statusCode === HttpStatusCode.NotModified
    ) {
      res.end();
    } else if (typeof body === "string" || Buffer.isBuffer(body)) {
      const output = body;
      if (!res.hasHeader(HttpHeaderName.ContentType)) {
        res.setHeader(
          HttpHeaderName.ContentType,
          `${HttpMediaType.TextPlain}; charset=utf-8`,
        );
      }
      if (headRequest) {
        if (!res.hasHeader(HttpHeaderName.ContentLength)) {
          res.setHeader(
            HttpHeaderName.ContentLength,
            Buffer.isBuffer(output)
              ? output.byteLength
              : Buffer.byteLength(output),
          );
        }
        res.end();
      } else {
        res.end(output);
      }
    } else if (isAsyncIterable(body)) {
      if (headRequest) {
        res.end();
      } else {
        await this.sendStream(res, body);
      }
    } else {
      const output = JSON.stringify(body);
      if (!res.hasHeader(HttpHeaderName.ContentType)) {
        res.setHeader(
          HttpHeaderName.ContentType,
          `${HttpMediaType.ApplicationJson}; charset=utf-8`,
        );
      }
      if (headRequest) {
        if (!res.hasHeader(HttpHeaderName.ContentLength)) {
          res.setHeader(
            HttpHeaderName.ContentLength,
            output === undefined ? 0 : Buffer.byteLength(output),
          );
        }
        res.end();
      } else {
        res.end(output);
      }
    }
  }

  private async sendStream(res: ServerResponse, body: AsyncIterable<unknown>) {
    const iterator = body[Symbol.asyncIterator]();
    let closeHandler!: () => void;
    const closed = new Promise<void>((resolve) => {
      closeHandler = resolve;
      res.once("close", closeHandler);
    });
    const closedResult = closed.then((): typeof streamClosed => streamClosed);
    let completed = false;

    try {
      while (!res.destroyed) {
        const next = await Promise.race([iterator.next(), closedResult]);
        if (next === streamClosed) return;
        if (next.done) {
          completed = true;
          break;
        }

        const chunk = next.value;
        if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
          throw new TypeError(
            "Streaming response chunks must be strings or Uint8Array values",
          );
        }
        if (!res.hasHeader(HttpHeaderName.ContentType)) {
          res.setHeader(HttpHeaderName.ContentType, "application/octet-stream");
        }

        if (!res.write(chunk) && !(await waitForDrain(res))) return;
      }

      if (!res.destroyed && !res.writableEnded) {
        if (!res.hasHeader(HttpHeaderName.ContentType)) {
          res.setHeader(HttpHeaderName.ContentType, "application/octet-stream");
        }
        res.end();
      }
    } finally {
      res.off("close", closeHandler);
      if (!completed) {
        void Promise.resolve(iterator.return?.()).catch(() => {});
      }
    }
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    value !== undefined &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      "function"
  );
}

function waitForDrain(res: ServerResponse) {
  if (res.destroyed || !res.writable) return Promise.resolve(false);

  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve(true);
    };
    const onClose = () => {
      cleanup();
      resolve(false);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}
