import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { HttpBodyParser, HttpError, HttpRequest, HttpStatusCode } from "../src";

function createRequest(
  chunks: Buffer[],
  contentLength?: number,
  contentType: string | null = "application/json",
  rawHeaders?: string[],
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
    ...(rawHeaders === undefined ? {} : { rawHeaders }),
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

  it("returns binary request bodies as a Buffer", async () => {
    const body = Buffer.from([0x00, 0xff, 0x80, 0x41, 0x00]);
    const request = createRequest(
      [body.subarray(0, 2), body.subarray(2)],
      body.byteLength,
      "application/octet-stream",
    );

    assert.deepEqual(await parser.parse<Buffer>(request), body);
  });

  it("parses multipart fields, repeated names, and binary file data", async () => {
    const boundary = "----test-boundary";
    const fileData = Buffer.from([0x00, 0xff, 0x80, 0x0d, 0x0a]);
    const body = Buffer.concat([
      Buffer.from(`Preamble mentions --${boundary} but is not a delimiter\r\n`),
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="title"\r\n' +
          "\r\n" +
          "A multipart example\r\n" +
          `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="tag"\r\n' +
          "\r\n" +
          "one\r\n" +
          `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="tag"\r\n' +
          "\r\n" +
          "two\r\n" +
          `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="upload"; filename="sample.bin"\r\n' +
          "Content-Type: application/octet-stream\r\n" +
          "\r\n",
      ),
      fileData,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const request = createRequest(
      [body.subarray(0, 57), body.subarray(57)],
      body.byteLength,
      `multipart/form-data; boundary="${boundary}"`,
    );

    assert.deepEqual(await parser.parse(request), {
      title: "A multipart example",
      tag: ["one", "two"],
      upload: {
        filename: "sample.bin",
        contentType: "application/octet-stream",
        data: fileData,
      },
    });
  });

  it("rejects multipart requests without a valid boundary or structure", async () => {
    const missingBoundary = createRequest(
      [Buffer.from("")],
      undefined,
      "multipart/form-data",
    );
    await assert.rejects(
      () => parser.parse(missingBoundary),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "Invalid multipart/form-data boundary",
    );

    const malformed = createRequest(
      [Buffer.from("--boundary\r\nnot a header\r\n\r\nvalue")],
      undefined,
      "multipart/form-data; boundary=boundary",
    );
    await assert.rejects(
      () => parser.parse(malformed),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "Invalid multipart/form-data request body",
    );
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
            "Content-Type must be application/json, application/x-www-form-urlencoded, application/octet-stream, or multipart/form-data",
      );
    }
  });

  it("rejects malformed Content-Type parameters", async () => {
    for (const contentType of [
      "application",
      'application/json; charset="utf-8',
      "application/json; charset=utf 8",
      "application/json; charset=utf-8; charset=utf-8",
    ]) {
      await assert.rejects(
        () =>
          parser.parse(
            createRequest([Buffer.from("{}")], undefined, contentType),
          ),
        (error: unknown) =>
          error instanceof HttpError &&
          error.status === HttpStatusCode.BadRequest &&
          error.message === "Invalid Content-Type header",
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

  it("rejects invalid UTF-8 in JSON and URL-encoded bodies", async () => {
    const invalidUtf8 = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]);
    await assert.rejects(
      () => parser.parse(createRequest([invalidUtf8])),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest,
    );

    await assert.rejects(
      () =>
        parser.parse(
          createRequest(
            [Buffer.from("name=%E0%A4%A")],
            undefined,
            "application/x-www-form-urlencoded",
          ),
        ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "Invalid URL-encoded request body",
    );
  });

  it("rejects ambiguous and invalid request framing headers", async () => {
    const duplicateLength = createRequest(
      [Buffer.from("{}")],
      2,
      "application/json",
      ["host", "localhost", "content-length", "2", "content-length", "2"],
    );
    await assert.rejects(
      () => parser.parse(duplicateLength),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "Multiple content-length headers are not allowed",
    );

    const requestWithBothFramingHeaders = createRequest([Buffer.from("{}")], 2);
    requestWithBothFramingHeaders.headers["transfer-encoding"] = "chunked";
    await assert.rejects(
      () => parser.parse(requestWithBothFramingHeaders),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message ===
          "Content-Length and Transfer-Encoding cannot be used together",
    );

    const invalidLength = createRequest([Buffer.from("{}")], 2);
    invalidLength.headers["content-length"] = "2e0";
    await assert.rejects(
      () => parser.parse(invalidLength),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "Invalid Content-Length header",
    );

    const chunked = createRequest([Buffer.from('{"chunked":true}')]);
    chunked.headers["transfer-encoding"] = "chunked";
    assert.deepEqual(await parser.parse(chunked), { chunked: true });
  });

  it("turns interrupted request streams into a client error", async () => {
    const interruptedStream = Readable.from(
      (async function* () {
        yield Buffer.from("{");
        throw new Error("simulated disconnect");
      })(),
    );
    const request = Object.assign(interruptedStream, {
      headers: {
        host: "localhost",
        "content-type": "application/json",
      },
      method: "POST",
      url: "/",
    }) as unknown as IncomingMessage;

    await assert.rejects(
      () => parser.parse(request),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message ===
          "Request body was interrupted before it was fully received",
    );
  });

  it("rejects a declared body over the limit before reading it", async () => {
    const request = createRequest([Buffer.from("not consumed")], 100);
    await assert.rejects(
      () => parser.parse(request, 8),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.PayloadTooLarge,
    );
  });

  it("bounds multipart part count and rejects invalid part headers", async () => {
    const boundary = "limit-boundary";
    const parts = Array.from(
      { length: 1_001 },
      () =>
        `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\nx\r\n`,
    ).join("");
    const tooManyParts = createRequest(
      [Buffer.from(`${parts}--${boundary}--\r\n`)],
      undefined,
      `multipart/form-data; boundary=${boundary}`,
    );
    await assert.rejects(
      () => parser.parse(tooManyParts),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest,
    );

    const malformedHeader = createRequest(
      [
        Buffer.from(
          `--${boundary}\r\nContent-Disposition : form-data; name="a"\r\n\r\nx\r\n--${boundary}--`,
        ),
      ],
      undefined,
      `multipart/form-data; boundary=${boundary}`,
    );
    await assert.rejects(
      () => parser.parse(malformedHeader),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "Invalid multipart/form-data request body",
    );
  });

  it("limits URL-encoded field counts to prevent excessive object expansion", async () => {
    const body = Buffer.from(
      Array.from({ length: 10_001 }, (_, index) => `field${index}=x`).join("&"),
    );
    await assert.rejects(
      () =>
        parser.parse(
          createRequest([body], undefined, "application/x-www-form-urlencoded"),
        ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "URL-encoded request body contains too many fields",
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

describe("HttpRequest raw body streams", () => {
  it("streams bodies without a Content-Length and enforces the byte limit", async () => {
    const request = new HttpRequest(
      createRequest(
        [Buffer.from("1234"), Buffer.from("5678")],
        undefined,
        "application/octet-stream",
      ),
    );
    const body = request.streamBody({ maxBytes: 5 });

    await assert.rejects(
      async () => {
        for await (const _chunk of body) {
          // Consume the stream to exercise the incremental size check.
        }
      },
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.PayloadTooLarge,
    );
  });

  it("validates streamed Content-Length after the body ends", async () => {
    const request = new HttpRequest(
      createRequest([Buffer.from("abc")], 4, "application/octet-stream"),
    );

    await assert.rejects(
      async () => {
        for await (const _chunk of request.streamBody()) {
          // Consume the stream so its final length check runs.
        }
      },
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === HttpStatusCode.BadRequest &&
        error.message === "Request body length does not match Content-Length",
    );
  });

  it("does not allow the body to be claimed more than once", async () => {
    const request = new HttpRequest(
      createRequest([Buffer.from("abc")], 3, "application/octet-stream"),
    );
    const body = request.streamBody();

    assert.throws(() => request.streamBody(), /already been claimed/);
    await assert.rejects(
      request.parseBody(),
      /already been claimed as a stream/,
    );

    for await (const _chunk of body) {
      // Drain the one allowed consumer.
    }
  });
});
