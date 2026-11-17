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
  BooleanField,
  getModelMetadata,
  IntegerField,
  ModelValidationError,
  NumberField,
  validateModel,
  type ModelConstructor,
} from "@framework/core";
import { getRequestModelMetadata } from "./request/RequestModelMetadata.js";

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
  private _requestModels = new WeakMap<ModelConstructor, Promise<unknown>>();
  private readonly _abortController = new AbortController();

  readonly method: string;
  readonly url: URL;
  readonly path: string;
  readonly signal = this._abortController.signal;
  private _params: Record<string, string> = {};

  get params() {
    return this._params;
  }

  set params(value: Record<string, string>) {
    this._params = value;
    this._requestModels = new WeakMap();
  }

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

  /** Collects, validates, and returns a model assembled from request sources. */
  async model<T>(model: ModelConstructor<T>): Promise<T> {
    let requestModel = this._requestModels.get(model);
    if (!requestModel) {
      requestModel = this.createRequestModel(model);
      this._requestModels.set(model, requestModel);
    }
    return (await requestModel) as T;
  }

  private async createRequestModel<T>(model: ModelConstructor<T>): Promise<T> {
    const sourceMetadata = getRequestModelMetadata(model);
    const modelMetadata = getModelMetadata(model);
    if (!modelMetadata) {
      throw new TypeError(
        `${model.name || "Model"} is not decorated with @Model`,
      );
    }

    const input: Record<string, unknown> = {};
    for (const source of sourceMetadata.fields) {
      const field = modelMetadata.fields.get(source.property);
      if (!field || !field.type) {
        throw new TypeError(
          `Request source field ${source.property} is missing @Field metadata`,
        );
      }
      const fieldType = field.type;
      const name = source.name ?? source.property;
      let value: unknown;
      switch (source.source) {
        case "path":
          value = this.params[name];
          break;
        case "query": {
          const values = this.url.searchParams.getAll(name);
          if (values.length > 0) {
            value = hasArrayFieldType(fieldType)
              ? values
              : values.length === 1
                ? values[0]
                : values;
          }
          break;
        }
        case "header": {
          const header = this.headers[name.toLowerCase()];
          if (header !== undefined) {
            value =
              hasArrayFieldType(fieldType) && !Array.isArray(header)
                ? [header]
                : header;
          }
          break;
        }
      }
      if (value !== undefined) {
        input[source.property] = coerceRequestValue(value, fieldType);
      }
    }

    if (sourceMetadata.body) {
      const bodyField = sourceMetadata.body;
      input[bodyField.property] = await this.parseBody({
        model: bodyField.model!,
        maxBytes: bodyField.bodyMaxBytes,
      });
    }

    return this.validateRequestModel(input, model);
  }

  private validateRequestModel<T>(input: unknown, model: ModelConstructor<T>) {
    try {
      return validateModel(input, model);
    } catch (error) {
      if (error instanceof ModelValidationError) {
        throw new HttpError(
          HttpStatusCode.UnprocessableEntity,
          "Request failed model validation",
          error.issues,
        );
      }
      throw error;
    }
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

function hasArrayFieldType(type: Function) {
  return Object.hasOwn(type, "itemType");
}

function coerceRequestValue(value: unknown, type: Function): unknown {
  const itemType = (type as typeof type & { itemType?: Function }).itemType;
  if (itemType) {
    const values = Array.isArray(value) ? value : [value];
    return values.map((item) => coerceRequestValue(item, itemType));
  }
  if (typeof value !== "string") return value;
  if (isFieldType(type, BooleanField)) {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  if (isFieldType(type, IntegerField) && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (
    isFieldType(type, NumberField) &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return value;
}

function isFieldType(type: Function, base: Function) {
  return type === base || type.prototype instanceof base;
}
