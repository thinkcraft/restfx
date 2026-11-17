import { ServerResponse } from "node:http";

export class HttpResponse {
  constructor(readonly res: ServerResponse) {}

  setHeader(name: string, value: string | number | readonly string[]) {
    this.res.setHeader(name, value);
  }

  appendHeader(name: string, value: string) {
    this.res.appendHeader(name, value);
  }
}
