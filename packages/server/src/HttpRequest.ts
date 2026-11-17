import { IncomingMessage } from "node:http";
import { HttpHeaderName } from "./HttpHeaderName.js";
import { HttpBodyParser } from "./parsing/HttpBodyParser.js";

export class HttpRequest {
  private _body: unknown;
  private readonly _bodyParser = new HttpBodyParser();

  readonly method: string;
  readonly url: URL;
  params: Record<string, string> = {};

  get headers() {
    return this.req.headers;
  }

  get status() {
    return this.req.statusCode;
  }

  constructor(readonly req: IncomingMessage) {
    const proto = req.headers[HttpHeaderName.XForwardedProto] ?? "http";
    const host =
      req.headers[HttpHeaderName.XForwardedHost] ??
      req.headers[HttpHeaderName.Host] ??
      "localhost";

    this.method = this.req.method?.toUpperCase() ?? "GET";
    this.url = new URL(req.url!, `${proto}://${host}`);
  }

  async parseBody<T>(maxBytes = 1_048_576): Promise<T> {
    if (!this._body) {
      this._body = this._bodyParser.parse<T>(this.req, maxBytes);
    }

    return this._body as T;
  }
}
