export interface HttpResponseBodySink {
  /** Write one response chunk, waiting for the connection to accept more data. */
  write(chunk: string | Uint8Array): Promise<void>;
}

export type HttpResponseBodyWriter = (
  sink: HttpResponseBodySink,
) => Promise<void>;

export class HttpResult<TBody = unknown> {
  public status?: number;
  public body?: TBody | HttpResponseBodyWriter;
  public headers?: Record<string, string | string[]>;

  constructor(
    status?: number,
    body?: HttpResponseBodyWriter,
    headers?: Record<string, string | string[]>,
  );
  constructor(
    status?: number,
    body?: TBody,
    headers?: Record<string, string | string[]>,
  );
  constructor(
    status?: number,
    body?: TBody | HttpResponseBodyWriter,
    headers?: Record<string, string | string[]>,
  ) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}
