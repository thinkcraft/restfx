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
  readonly requestId: string | undefined;

  constructor(
    readonly req: HttpRequest,
    readonly res: HttpResponse,
    requestId?: string,
    readonly container: IocContainer = new IocContainer().createRequestScope(),
    options: { readonly requestIdEnabled?: boolean } = {},
  ) {
    this.requestId =
      options.requestIdEnabled === false
        ? undefined
        : (requestId ?? randomUUID());
    this.signal = req.signal;
    this.cookies = new HttpCookies(req.headers.cookie, res);
    if (this.requestId !== undefined) {
      this.res.setHeader(HttpHeaderName.XRequestId, this.requestId);
    }
  }
}
