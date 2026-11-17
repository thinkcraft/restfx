import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { HttpBodyParser, HttpError, HttpStatusCode } from "../src";

function createRequest(
  chunks: Buffer[],
  contentLength?: number,
  contentType: string | null = "application/json",
) {
  const headers: Record<string, string> = { host: "localhost" };
  if (contentLength !== undefined) {
    headers["content-length"] = String(contentLength);
  }
  if (contentType !== null) {
    headers["content-type"] = contentType;
  }

  return Object.assign(Readable.from(chunks), {
    headers,
    method: "POST",
    url: "/",
  }) as unknown as IncomingMessage;
}

describe("HttpBodyParser", () => {
  const parser = new HttpBodyParser();

  it("parses JSON across chunks and counts Content-Length in bytes", async () => {
    const expected = { text: "café", items: [1, 2] };
    const body = Buffer.from(JSON.stringify(expected));
    const request = createRequest(
      [body.subarray(0, 10), body.subarray(10)],
      body.byteLength,
    );

    assert.deepEqual(await parser.parse(request), expected);
  });

  it("accepts JSON media types with structured suffixes", async () => {
    const body = Buffer.from(JSON.stringify({ title: "Invalid request" }));
    const request = createRequest(
      [body],
      body.byteLength,
      "application/problem+json; charset=utf-8",
    );

    assert.deepEqual(await parser.parse(request), { title: "Invalid request" });
  });

  it("parses URL-encoded form fields and repeated values", async () => {
    const body = Buffer.from(
      "name=Jane+Doe&message=hello%2Bworld&tag=one&tag=two&empty=",
    );
    const request = createRequest(
      [body],
      body.byteLength,
      "application/x-www-form-urlencoded; charset=UTF-8",
    );

    assert.deepEqual(await parser.parse(request), {
      name: "Jane Doe",
      message: "hello+world",
      tag: ["one", "two"],
      empty: "",
    });
  });

  it("rejects missing and unsupported Content-Type headers", async () => {
    for (const contentType of [null, "text/plain"]) {
      const request = createRequest(
        [Buffer.from("{}")],
        undefined,
        contentType,
      );

      await assert.rejects(
        () => parser.parse(request),
        (error: unknown) =>
          error instanceof HttpError &&
          error.status === HttpStatusCode.UnsupportedMediaType &&
          error.message ===
            "Content-Type must be application/json or application/x-www-form-urlencoded",
      );
    }
  });

  it("rejects a body whose byte length does not match Content-Length", async () => {
    const body = Buffer.from(JSON.stringify({ text: "café" }));
    const request = createRequest([body], body.byteLength - 1);

    await assert.rejects(
      () => parser.parse(request),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "Request body length does not match Content-Length",
    );
  });

  it("rejects malformed JSON", async () => {
    const body = Buffer.from("{invalid json}");
    const request = createRequest([body], body.byteLength);

    await assert.rejects(
      () => parser.parse(request),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "Invalid JSON request body",
    );
  });

  it("rejects bodies larger than the configured limit", async () => {
    const request = createRequest([
      Buffer.from("123456"),
      Buffer.from("7890"),
      Buffer.from("discarded"),
    ]);

    await assert.rejects(
      () => parser.parse(request, 8),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.PayloadTooLarge &&
        error.message === "Request body exceeds the maximum allowed size",
    );
  });

  it("rejects invalid body size limits", async () => {
    const request = createRequest([]);

    await assert.rejects(() => parser.parse(request, -1), RangeError);
  });
});
