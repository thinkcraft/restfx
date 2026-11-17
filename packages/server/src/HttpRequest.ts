import { IncomingMessage } from "node:http";
import { HttpHeaderName } from "./HttpHeaderName.js";
import { HttpBodyParser } from "./parsing/HttpBodyParser.js";
import { HttpError } from "./HttpError.js";
import { HttpStatusCode } from "./HttpStatusCode.js";

export class HttpRequest {
  private _body?: Promise<unknown>;
  private readonly _bodyParser = new HttpBodyParser();

  readonly method: string;
  readonly url: URL;
  readonly path: string;
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
        throw new Error("Invalid host authority");
      }
      return parsed.host;
    } catch {
      throw new HttpError(HttpStatusCode.BadRequest, "Invalid Host header");
    }
  }

  async parseBody<T>(maxBytes = 1_048_576): Promise<T> {
    if (this._body === undefined) {
      this._body = this._bodyParser.parse<T>(this.req, maxBytes);
    }

    return (await this._body) as T;
  }
}
