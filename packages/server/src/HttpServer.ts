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
import { HttpRouter } from "./routing/HttpRouter.js";
import { IocContainer } from "./IocContainer.js";

const requestIdPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

export interface HttpServerOptions {
  /** Options passed to Node's `http.createServer()`. */
  readonly serverOptions?: ServerOptions;
  /** Root service container shared by requests. */
  readonly container?: IocContainer;
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
  private readonly _container: IocContainer;
  private _closePromise?: Promise<void>;

  constructor(rootResource: new () => object, options: HttpServerOptions = {}) {
    this._router = new HttpRouter(rootResource);
    this._container = options.container ?? new IocContainer();
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
    const response = new HttpResponse(res);
    let context: HttpContext | undefined;
    try {
      const requestId = getRequestId(req.headers[HttpHeaderName.XRequestId]);
      response.setHeader(HttpHeaderName.XRequestId, requestId);
      context = new HttpContext(
        new HttpRequest(
          req,
          this._trustProxy?.(req.socket.remoteAddress) ?? false,
        ),
        response,
        requestId,
        this._container.createRequestScope(),
      );
      this.notify(this._onRequest, context);
      const result = await this._router.dispatch(context);
      if (!result.matched) {
        if (result.status === HttpStatusCode.MethodNotAllowed) {
          response.setHeader(
            HttpHeaderName.Allow,
            result.allowedMethods.join(", "),
          );
          await response.send(
            new HttpResult(
              HttpStatusCode.MethodNotAllowed,
              "Method Not Allowed",
            ),
            req.method === "HEAD",
          );
        } else {
          await response.send(
            new HttpResult(HttpStatusCode.NotFound, "Not Found"),
            req.method === "HEAD",
          );
        }
        return;
      }

      await response.send(result.value, req.method === "HEAD");
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

      await response.send(result, req.method === "HEAD");
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
}

function getRequestId(value: string | string[] | undefined) {
  if (typeof value === "string" && requestIdPattern.test(value)) return value;
  return randomUUID();
}
