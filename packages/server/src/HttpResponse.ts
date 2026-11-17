import { ServerResponse } from "node:http";

export class HttpResponse {
  constructor(readonly res: ServerResponse) {}
}
