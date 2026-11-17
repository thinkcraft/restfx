import { randomUUID } from "node:crypto";
import { HttpHeaderName } from "./HttpHeaderName.js";
import { HttpRequest } from "./HttpRequest.js";
import { HttpResponse } from "./HttpResponse.js";
import { HttpCookies } from "./HttpCookies.js";
import { IocContainer } from "./IocContainer.js";

/** Application-defined values shared by middleware and handlers for one request. */
export interface HttpContextState extends Record<string, unknown> {}

export class HttpContext {
  readonly signal: AbortSignal;
  readonly cookies: HttpCookies;
  readonly state: HttpContextState = {};

  constructor(
    readonly req: HttpRequest,
    readonly res: HttpResponse,
    readonly requestId: string = randomUUID(),
    readonly container: IocContainer = new IocContainer().createRequestScope(),
  ) {
    this.signal = req.signal;
    this.cookies = new HttpCookies(req.headers.cookie, res);
    this.res.setHeader(HttpHeaderName.XRequestId, this.requestId);
  }
}
