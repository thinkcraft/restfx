import { HttpRequest } from "./HttpRequest.js";
import { HttpResponse } from "./HttpResponse.js";

export class HttpContext {
  constructor(
    readonly req: HttpRequest,
    readonly res: HttpResponse,
  ) {}
}
