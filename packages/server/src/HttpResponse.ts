import { ServerResponse } from "node:http";
import { HttpHeaderName } from "./HttpHeaderName.js";
import { HttpMediaType } from "./HttpMediaType.js";
import { HttpResult } from "./HttpResult.js";
import { HttpStatusCode } from "./HttpStatusCode.js";

const streamClosed: unique symbol = Symbol("stream closed");

export class HttpResponse {
  constructor(readonly res: ServerResponse) {}

  setHeader(name: string, value: string | number | readonly string[]) {
    this.res.setHeader(name, value);
  }

  appendHeader(name: string, value: string) {
    this.res.appendHeader(name, value);
  }

  async send(value: unknown, headRequest = false) {
    if (this.res.writableEnded) return;

    const result =
      value instanceof HttpResult ? value : new HttpResult(undefined, value);
    const body = result.body;
    this.res.statusCode =
      result.status ??
      (body === undefined ? HttpStatusCode.NoContent : HttpStatusCode.Ok);

    for (const [name, headerValue] of Object.entries(result.headers ?? {})) {
      this.res.setHeader(name, headerValue);
    }

    if (
      body === undefined ||
      this.res.statusCode === HttpStatusCode.NoContent ||
      this.res.statusCode === HttpStatusCode.NotModified
    ) {
      this.res.end();
    } else if (typeof body === "string" || Buffer.isBuffer(body)) {
      if (!this.res.hasHeader(HttpHeaderName.ContentType)) {
        this.res.setHeader(
          HttpHeaderName.ContentType,
          `${HttpMediaType.TextPlain}; charset=utf-8`,
        );
      }
      if (headRequest) {
        if (!this.res.hasHeader(HttpHeaderName.ContentLength)) {
          this.res.setHeader(
            HttpHeaderName.ContentLength,
            Buffer.isBuffer(body) ? body.byteLength : Buffer.byteLength(body),
          );
        }
        this.res.end();
      } else {
        this.res.end(body);
      }
    } else if (isAsyncIterable(body)) {
      if (headRequest) {
        this.res.end();
      } else {
        await this.sendStream(body);
      }
    } else {
      const output = JSON.stringify(body);
      if (!this.res.hasHeader(HttpHeaderName.ContentType)) {
        this.res.setHeader(
          HttpHeaderName.ContentType,
          `${HttpMediaType.ApplicationJson}; charset=utf-8`,
        );
      }
      if (headRequest) {
        if (!this.res.hasHeader(HttpHeaderName.ContentLength)) {
          this.res.setHeader(
            HttpHeaderName.ContentLength,
            output === undefined ? 0 : Buffer.byteLength(output),
          );
        }
        this.res.end();
      } else {
        this.res.end(output);
      }
    }
  }

  private async sendStream(body: AsyncIterable<unknown>) {
    const iterator = body[Symbol.asyncIterator]();
    let closeHandler!: () => void;
    const closed = new Promise<void>((resolve) => {
      closeHandler = resolve;
      this.res.once("close", closeHandler);
    });
    const closedResult = closed.then((): typeof streamClosed => streamClosed);
    let completed = false;

    try {
      while (!this.res.destroyed) {
        const next = await Promise.race([iterator.next(), closedResult]);
        if (next === streamClosed) return;
        if (next.done) {
          completed = true;
          break;
        }

        const chunk = next.value;
        if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
          throw new TypeError(
            "Streaming response chunks must be strings or Uint8Array values",
          );
        }
        if (!this.res.hasHeader(HttpHeaderName.ContentType)) {
          this.res.setHeader(
            HttpHeaderName.ContentType,
            "application/octet-stream",
          );
        }

        if (!this.res.write(chunk) && !(await waitForDrain(this.res))) return;
      }

      if (!this.res.destroyed && !this.res.writableEnded) {
        if (!this.res.hasHeader(HttpHeaderName.ContentType)) {
          this.res.setHeader(
            HttpHeaderName.ContentType,
            "application/octet-stream",
          );
        }
        this.res.end();
      }
    } finally {
      this.res.off("close", closeHandler);
      if (!completed) {
        void Promise.resolve(iterator.return?.()).catch(() => {});
      }
    }
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    value !== undefined &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      "function"
  );
}

function waitForDrain(res: ServerResponse) {
  if (res.destroyed || !res.writable) return Promise.resolve(false);

  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve(true);
    };
    const onClose = () => {
      cleanup();
      resolve(false);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}
