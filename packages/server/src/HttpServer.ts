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
import {
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  validateMaxRequestBodyBytes,
} from "./parsing/requestBodyLimits.js";

const requestIdPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

export interface HttpServerOptions {
  /** Options passed to Node's `http.createServer()`. */
  readonly serverOptions?: ServerOptions;
  /** Maximum request body size in bytes. Defaults to 1 MiB. */
  readonly maxRequestBodyBytes?: number;
  /** Root service container shared by requests. */
  readonly container?: IocContainer;
  /** Enable the `X-Request-Id` request and response header. Defaults to `true`. */
  readonly requestId?: boolean;
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
  private readonly _requestIdEnabled: boolean;
  private readonly _errorHandler?: HttpServerOptions["errorHandler"];
  private readonly _onError?: HttpServerOptions["onError"];
  private readonly _onRequest?: HttpServerOptions["onRequest"];
  private readonly _onResponse?: HttpServerOptions["onResponse"];
  private readonly _container: IocContainer;
  private readonly _maxRequestBodyBytes: number;
  private _closePromise?: Promise<void>;

  constructor(rootResource: new () => object, options: HttpServerOptions = {}) {
    this._router = new HttpRouter(rootResource);
    this._container = options.container ?? new IocContainer();
    this._maxRequestBodyBytes =
      options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
    validateMaxRequestBodyBytes(this._maxRequestBodyBytes);
    this._trustProxy = options.trustProxy;
    this._requestIdEnabled = options.requestId ?? true;
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
      const requestId = this._requestIdEnabled
        ? getRequestId(req.headers[HttpHeaderName.XRequestId])
        : undefined;
      context = new HttpContext(
        new HttpRequest(
          req,
          this._trustProxy?.(req.socket.remoteAddress) ?? false,
          this._maxRequestBodyBytes,
        ),
        response,
        requestId,
        this._container.createRequestScope(),
        { requestIdEnabled: this._requestIdEnabled },
      );
      this.notify(this._onRequest, context);
      const result = await this._router.dispatch(context);
      if (!result.matched) {
        await this.sendUnmatchedResponse(result, req, response);
        return;
      }

      await response.send(result.value, req.method === "HEAD");
    } catch (error) {
      await this.handleRequestError(error, context, req, res, response);
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

  private async sendUnmatchedResponse(
    result: Extract<
      Awaited<ReturnType<HttpRouter["dispatch"]>>,
      { matched: false }
    >,
    req: IncomingMessage,
    response: HttpResponse,
  ) {
    const headRequest = req.method === "HEAD";
    if (result.status === HttpStatusCode.MethodNotAllowed) {
      response.setHeader(
        HttpHeaderName.Allow,
        result.allowedMethods.join(", "),
      );
      await response.send(
        new HttpResult(HttpStatusCode.MethodNotAllowed, "Method Not Allowed"),
        headRequest,
      );
      return;
    }
    await response.send(
      new HttpResult(HttpStatusCode.NotFound, "Not Found"),
      headRequest,
    );
  }

  private async handleRequestError(
    error: unknown,
    context: HttpContext | undefined,
    req: IncomingMessage,
    res: ServerResponse,
    response: HttpResponse,
  ) {
    this.notifyError(error, context);
    if (req.aborted || res.destroyed || res.writableEnded) return;
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }

    this.closeIncompleteRequest(req, res);
    const result = await this.createErrorResult(error, context);
    await response.send(result, req.method === "HEAD");
  }

  private async createErrorResult(error: unknown, context?: HttpContext) {
    if (!this._errorHandler) return this.createDefaultErrorResult(error);
    try {
      return await this._errorHandler(error, context);
    } catch (handlerError) {
      this.notifyError(handlerError, context);
      return this.createInternalServerError();
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
