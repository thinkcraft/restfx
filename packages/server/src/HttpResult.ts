export class HttpResult<TBody = unknown> {
  constructor(
    public status?: number,
    public body?: TBody,
    public headers?: Record<string, string | string[]>,
  ) {}
}
