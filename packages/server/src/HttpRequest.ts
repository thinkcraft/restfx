import { IncomingMessage } from "node:http";

export class HttpRequest {
  readonly url: URL;
  params: Record<string, string> = {};

  get status() {
    return this.req.statusCode;
  }

  constructor(readonly req: IncomingMessage) {
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    const host =
      req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";

    this.url = new URL(req.url!, `${proto}://${host}`);
  }
}
