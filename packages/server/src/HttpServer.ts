import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
  type ServerOptions,
} from "node:http";
import { randomUUID } from "node:crypto";
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
const requestIdPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

export interface HttpServerOptions {
  /** Options passed to Node's `http.createServer()`. */
  readonly serverOptions?: ServerOptions;
  /**
   * Return true only when the connecting peer is a trusted reverse proxy.
   * Forwarded headers are ignored by default.
   */
  readonly trustProxy?: (remoteAddress: string | undefined) => boolean;
  /** Replace the default error response. This is not called for errors after headers are sent. */
  readonly errorHandler?: HttpErrorHandler;
  /** Observe errors, including errors that cannot be converted to a response. Observer failures are ignored. */
  readonly onError?: (error: unknown, context?: HttpContext) => void;
  /** Called after a request context is created. Observer failures are ignored. */
  readonly onRequest?: (context: HttpContext) => void;
  /** Called after response handling finishes. Observer failures are ignored. */
  readonly onResponse?: (
    context: HttpContext,
    metrics: HttpResponseMetrics,
  ) => void;
}

export type HttpErrorHandler = (
  error: unknown,
  context?: HttpContext,
) => HttpResult | Promise<HttpResult>;

export interface HttpResponseMetrics {
  readonly statusCode: number;
  readonly durationMs: number;
  /** True when the response was ended by the server. */
  readonly completed: boolean;
}

export interface HttpServerCloseOptions {
  /** Force-close remaining connections after this many milliseconds. */
  readonly timeoutMs?: number;
}

export class HttpServer {
  private readonly _server: Server;
  private readonly _router: HttpRouter;
  private readonly _trustProxy?: HttpServerOptions["trustProxy"];
  private readonly _errorHandler?: HttpServerOptions["errorHandler"];
  private readonly _onError?: HttpServerOptions["onError"];
  private readonly _onRequest?: HttpServerOptions["onRequest"];
  private readonly _onResponse?: HttpServerOptions["onResponse"];
  private _closePromise?: Promise<void>;

  constructor(rootResource: new () => object, options: HttpServerOptions = {}) {
    this._router = new HttpRouter(rootResource);
    this._trustProxy = options.trustProxy;
    this._errorHandler = options.errorHandler;
    this._onError = options.onError;
    this._onRequest = options.onRequest;
    this._onResponse = options.onResponse;
    this._server = createServer(
      options.serverOptions ?? {},
      this.handleRequest.bind(this),
    );
  }

  close(options: HttpServerCloseOptions = {}) {
    if (this._closePromise) return this._closePromise;
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
    ) {
      throw new RangeError("timeoutMs must be a non-negative finite number");
    }
    if (!this._server.listening) return Promise.resolve();

    this._closePromise = new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const clearTimer = () => {
        if (timer) clearTimeout(timer);
      };
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(
          () => this._server.closeAllConnections(),
          options.timeoutMs,
        );
        timer.unref();
      }
      try {
        this._server.close((error) => {
          clearTimer();
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        clearTimer();
        reject(error);
      }
    });
    return this._closePromise;
  }

  listen(port = 3000, callback?: () => void) {
    this._closePromise = undefined;
    return this._server.listen(port, callback);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const startedAt = performance.now();
    let context: HttpContext | undefined;
    try {
      const requestId = getRequestId(req.headers[HttpHeaderName.XRequestId]);
      res.setHeader(HttpHeaderName.XRequestId, requestId);
      context = new HttpContext(
        new HttpRequest(
          req,
          this._trustProxy?.(req.socket.remoteAddress) ?? false,
        ),
        new HttpResponse(res),
        requestId,
      );
      this.notify(this._onRequest, context);
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
      this.notifyError(error, context);
      if (req.aborted || res.destroyed || res.writableEnded) return;
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }

      this.closeIncompleteRequest(req, res);
      let result: HttpResult;
      if (this._errorHandler) {
        try {
          result = await this._errorHandler(error, context);
        } catch (handlerError) {
          this.notifyError(handlerError, context);
          result = this.createInternalServerError();
        }
      } else {
        result = this.createDefaultErrorResult(error);
      }

      await this.sendResult(res, result, req.method === "HEAD");
    } finally {
      if (context) {
        this.notify(this._onResponse, context, {
          statusCode: res.statusCode,
          durationMs: performance.now() - startedAt,
          completed: res.writableEnded,
        });
      }
    }
  }

  private createDefaultErrorResult(error: unknown) {
    if (error instanceof HttpError) {
      return new HttpResult(error.status, {
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }
    return this.createInternalServerError();
  }

  private createInternalServerError() {
    return new HttpResult(HttpStatusCode.InternalServerError, {
      message: "Internal Server Error",
    });
  }

  private notify<T extends unknown[]>(
    callback: ((...args: T) => void) | undefined,
    ...args: T
  ) {
    try {
      callback?.(...args);
    } catch {
      // Observability callbacks must not change HTTP behavior.
    }
  }

  private notifyError(error: unknown, context?: HttpContext) {
    this.notify(this._onError, error, context);
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

function getRequestId(value: string | string[] | undefined) {
  if (typeof value === "string" && requestIdPattern.test(value)) return value;
  return randomUUID();
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
