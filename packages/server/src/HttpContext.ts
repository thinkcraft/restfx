import { HttpRequest } from "./HttpRequest.js";
import { HttpResponse } from "./HttpResponse.js";
import { HttpCookies } from "./HttpCookies.js";

export class HttpContext {
  readonly signal: AbortSignal;
  readonly cookies: HttpCookies;

  constructor(
    readonly req: HttpRequest,
    readonly res: HttpResponse,
  ) {
    this.signal = req.signal;
    this.cookies = new HttpCookies(req.headers.cookie, res);
  }
}
