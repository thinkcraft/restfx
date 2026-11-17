import { HttpRequest } from "./HttpRequest.js";
import { HttpResponse } from "./HttpResponse.js";

export class HttpContext {
  readonly signal: AbortSignal;

  constructor(
    readonly req: HttpRequest,
    readonly res: HttpResponse,
  ) {
    this.signal = req.signal;
  }
}
