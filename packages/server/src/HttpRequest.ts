import { IncomingMessage } from "node:http";
import { HttpHeaderName } from "./HttpHeaderName.js";
import { HttpBodyParser } from "./parsing/HttpBodyParser.js";
import { HttpError } from "./HttpError.js";
import { HttpStatusCode } from "./HttpStatusCode.js";
import {
  createRequestBodyStream,
  type HttpRequestBodyStreamOptions,
} from "./parsing/createRequestBodyStream.js";
import {
  ModelValidationError,
  validateModel,
  type ModelConstructor,
} from "@framework/core";

export interface HttpParseBodyOptions<T = unknown> {
  readonly maxBytes?: number;
  readonly model?: ModelConstructor<T>;
}

export class HttpRequest {
  private _body?: Promise<unknown>;
  private _bodyParser?: HttpBodyParser;
  private _bodyMode: "unused" | "buffered" | "stream" = "unused";
  private _bodyModel?: ModelConstructor;
  private _validatedBody?: Promise<unknown>;
  private readonly _abortController = new AbortController();

  readonly method: string;
  readonly url: URL;
  readonly path: string;
  readonly signal = this._abortController.signal;
  params: Record<string, string> = {};

  get headers() {
    return this.req.headers;
  }

  get status() {
    return this.req.statusCode;
  }

  constructor(
    readonly req: IncomingMessage,
    trustProxy = false,
  ) {
    if (this.req.aborted) {
      this.abortRequest();
    } else {
      this.req.once("aborted", this.abortRequest);
      this.req.once("end", () => {
        this.req.off("aborted", this.abortRequest);
      });
    }

    this.method = this.req.method?.toUpperCase() ?? "GET";

    const forwardedProto = trustProxy
      ? this.getSingleHeader(HttpHeaderName.XForwardedProto)
      : undefined;
    const forwardedHost = trustProxy
      ? this.getSingleHeader(HttpHeaderName.XForwardedHost)
      : undefined;
    const proto = this.validateProtocol(forwardedProto ?? "http");
    const host = this.validateHost(
      forwardedHost ?? this.getSingleHeader(HttpHeaderName.Host) ?? "localhost",
      proto,
    );
    const requestTarget = req.url;

    if (
      requestTarget === undefined ||
      (!requestTarget.startsWith("/") && requestTarget !== "*") ||
      requestTarget.startsWith("//") ||
      /[\u0000-\u0020\u007f#\\]/.test(requestTarget)
    ) {
      throw new HttpError(HttpStatusCode.BadRequest, "Invalid request target");
    }

    try {
      const baseUrl = new URL(`${proto}://${host}`);
      const url = new URL(
        requestTarget === "*" ? "/*" : requestTarget,
        baseUrl,
      );
      if (url.origin !== baseUrl.origin) {
        // noinspection ExceptionCaughtLocallyJS
        throw new Error("Request target changed the URL origin");
      }
      this.url = url;
    } catch {
      throw new HttpError(HttpStatusCode.BadRequest, "Invalid request URL");
    }
    this.path = this.url.pathname;
  }

  private getSingleHeader(name: string) {
    const normalizedName = name.toLowerCase();
    const values: string[] = [];
    const rawHeaders = this.req.rawHeaders;

    if (rawHeaders) {
      for (let index = 0; index < rawHeaders.length; index += 2) {
        if (rawHeaders[index]?.toLowerCase() === normalizedName) {
          values.push(rawHeaders[index + 1] ?? "");
        }
      }
    }

    if (values.length > 1) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        `Multiple ${name} headers are not allowed`,
      );
    }

    const value = values[0] ?? this.req.headers[normalizedName];
    if (Array.isArray(value)) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        `Multiple ${name} headers are not allowed`,
      );
    }

    if (value?.includes(",")) {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        `Multiple ${name} values are not allowed`,
      );
    }

    return value;
  }

  private validateProtocol(value: string) {
    const protocol = value.toLowerCase();
    if (protocol !== "http" && protocol !== "https") {
      throw new HttpError(
        HttpStatusCode.BadRequest,
        "Invalid forwarded protocol",
      );
    }
    return protocol;
  }

  private validateHost(value: string, protocol: string) {
    if (value.length === 0 || /[\u0000-\u0020\u007f,\\/?#@]/.test(value)) {
      throw new HttpError(HttpStatusCode.BadRequest, "Invalid Host header");
    }

    try {
      const parsed = new URL(`${protocol}://${value}/`);
      if (
        parsed.username !== "" ||
        parsed.password !== "" ||
        parsed.pathname !== "/" ||
        parsed.search !== "" ||
        parsed.hash !== ""
      ) {
        // noinspection ExceptionCaughtLocallyJS
        throw new Error("Invalid host authority");
      }
      return parsed.host;
    } catch {
      throw new HttpError(HttpStatusCode.BadRequest, "Invalid Host header");
    }
  }

  async parseBody<T>(maxBytes?: number): Promise<T>;
  async parseBody<T>(options?: HttpParseBodyOptions<T>): Promise<T>;
  async parseBody<T>(
    maxBytesOrOptions: number | HttpParseBodyOptions<T> = 1_048_576,
  ): Promise<T> {
    if (this._bodyMode === "stream") {
      throw new Error("The request body has already been claimed as a stream");
    }
    this._bodyMode = "buffered";

    const options =
      typeof maxBytesOrOptions === "number"
        ? { maxBytes: maxBytesOrOptions }
        : maxBytesOrOptions;
    if (options.model) {
      if (this._bodyModel && this._bodyModel !== options.model) {
        throw new Error("The request body already has a different model");
      }
      this._bodyModel = options.model;
    }

    if (this._body === undefined) {
      this._body = (this._bodyParser ??= new HttpBodyParser()).parse<T>(
        this.req,
        options.maxBytes,
      );
    }

    if (this._bodyModel) {
      this._validatedBody ??= this._body.then((body) => {
        try {
          return validateModel(body, this._bodyModel!);
        } catch (error) {
          if (error instanceof ModelValidationError) {
            throw new HttpError(
              HttpStatusCode.UnprocessableEntity,
              "Request body failed model validation",
              error.issues,
            );
          }
          throw error;
        }
      });
      return (await this._validatedBody) as T;
    }

    return (await this._body) as T;
  }

  /**
   * Returns a one-shot, bounded stream of the raw request body. The default
   * limit is 1 MiB. Use parseBody() instead for buffered form or JSON payloads.
   */
  streamBody(options: HttpRequestBodyStreamOptions = {}) {
    if (this._bodyMode !== "unused") {
      throw new Error("The request body has already been claimed");
    }
    this._bodyMode = "stream";
    return createRequestBodyStream(this.req, options);
  }

  private readonly abortRequest = () => {
    const error = new Error("The client aborted the request");
    error.name = "AbortError";
    this._abortController.abort(error);
  };
}
