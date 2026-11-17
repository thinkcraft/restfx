import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { generateClient } from "../src";

const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "Client generation test", version: "1" },
  paths: {
    "/records/{id}": {
      post: {
        operationId: "createRecord",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateRecordBody" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RecordResponse" },
              },
            },
          },
        },
        "x-framework-client": {
          requestModel: {
            $ref: "#/components/schemas/CreateRecordRequest",
          },
          fields: [{ property: "id", source: "path", name: "id" }],
          body: {
            property: "payload",
            model: { $ref: "#/components/schemas/CreateRecordBody" },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      CreateRecordBody: {
        "x-framework-model": "CreateRecordBody",
        type: "object",
        properties: { name: { type: "string", minLength: 2 } },
      },
      CreateRecordRequest: {
        "x-framework-model": "CreateRecordRequest",
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          payload: { $ref: "#/components/schemas/CreateRecordBody" },
        },
      },
      RecordResponse: {
        "x-framework-model": "RecordResponse",
        type: "object",
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
  },
};

describe("API client generator", () => {
  it("preserves OpenAPI union branches as generated TypeScript types", () => {
    const document: Record<string, any> = structuredClone(openApiDocument);
    document.paths["/records/{id}"].post.responses["201"].content[
      "application/json"
    ].schema = {
      oneOf: [
        { $ref: "#/components/schemas/CatEvent" },
        { $ref: "#/components/schemas/DogEvent" },
      ],
      discriminator: {
        propertyName: "kind",
        mapping: {
          cat: "#/components/schemas/CatEvent",
          dog: "#/components/schemas/DogEvent",
        },
      },
    };
    document.components.schemas.CatEvent = {
      "x-framework-model": "CatEvent",
      type: "object",
      properties: {
        kind: { type: "string", enum: ["cat"] },
        date: { type: "string", format: "date" },
      },
    };
    document.components.schemas.DogEvent = {
      "x-framework-model": "DogEvent",
      type: "object",
      properties: { kind: { type: "string", enum: ["dog"] } },
    };

    const generated = generateClient(document, { models: "./models.js" });
    assert.match(generated, /import \{[^}]*CatEvent/s);
    assert.match(generated, /import \{[^}]*DogEvent/s);
    assert.match(generated, /as CatEvent \| DogEvent/);
  });

  it("generates model imports and validates requests before fetch", async () => {
    const generatedPath = new URL(
      "./.generated-client.test.ts",
      import.meta.url,
    );
    const generated = generateClient(openApiDocument, {
      models: "./models.js",
    });
    assert.match(generated, /import \{[^}]*CreateRecordRequest/s);
    assert.match(generated, /records:\s*\{/);
    assert.match(generated, /create:\s*async/);
    assert.match(
      generated,
      /validateModel\(requestInput, CreateRecordRequest\)/,
    );
    assert.ok(
      generated.indexOf("validateModel(requestInput") <
        generated.indexOf("client.request("),
    );

    await writeFile(generatedPath, generated, "utf8");
    try {
      const generatedClient = await import(
        generatedPath.href + `?v=${Date.now()}`
      );
      let fetchCalls = 0;
      let requestedUrl = "";
      const api = generatedClient.createApiClient({
        baseUrl: "http://example.test",
        fetch: async (input: URL | RequestInfo) => {
          fetchCalls++;
          requestedUrl = String(input);
          return new Response(
            JSON.stringify({ id: "550e8400-e29b-41d4-a716-446655440000" }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        },
      });

      await assert.rejects(
        api.records.create({ id: "not-a-uuid", payload: { name: "valid" } }),
        /validation failed/i,
      );
      await assert.rejects(
        api.records.create({
          id: "550e8400-e29b-41d4-a716-446655440000",
          payload: { name: "x" },
        }),
        /validation failed/i,
      );
      assert.equal(fetchCalls, 0);

      const response = await api.records.create({
        id: "550e8400-e29b-41d4-a716-446655440000",
        payload: { name: "valid", note: undefined },
      });
      assert.equal(fetchCalls, 1);
      assert.equal(
        requestedUrl,
        "http://example.test/records/550e8400-e29b-41d4-a716-446655440000",
      );
      assert.equal(response.id, "550e8400-e29b-41d4-a716-446655440000");
    } finally {
      await unlink(generatedPath).catch(() => undefined);
    }
  });

  it("rejects operations whose request params are not mapped to shared models", () => {
    const document = structuredClone(openApiDocument);
    document.paths["/records/{id}"].post.parameters.push({
      name: "extra",
      in: "query",
      required: false,
      schema: { type: "string", format: "string" },
    });
    assert.throws(
      () => generateClient(document, { models: "./models.js" }),
      /not represented by its request model/,
    );
  });

  it("serializes form and binary requests and decodes non-JSON responses", async () => {
    const document = {
      openapi: "3.1.0",
      info: { title: "Content types", version: "1" },
      paths: {
        "/uploads": {
          post: {
            operationId: "createUpload",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["title", "file"],
                    properties: {
                      title: { type: "string" },
                      file: { type: "string", format: "binary" },
                      tags: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
            responses: {
              "201": {
                description: "Created file",
                content: {
                  "application/octet-stream": {
                    schema: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
        },
        "/forms": {
          post: {
            operationId: "submitForm",
            requestBody: {
              required: true,
              content: {
                "application/x-www-form-urlencoded": {
                  schema: {
                    type: "object",
                    properties: {
                      search: { type: "string" },
                      tags: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Accepted",
                content: { "text/plain": { schema: { type: "string" } } },
              },
            },
          },
        },
        "/raw": {
          post: {
            operationId: "uploadRaw",
            requestBody: {
              required: true,
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            responses: {
              "200": {
                description: "Echo",
                content: {
                  "application/octet-stream": {
                    schema: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
        },
        "/xml": {
          post: {
            operationId: "sendXml",
            requestBody: {
              required: true,
              content: {
                "application/xml": { schema: { type: "string" } },
              },
            },
            responses: {
              "200": {
                description: "XML response",
                content: { "application/xml": { schema: { type: "string" } } },
              },
            },
          },
        },
      },
    };
    const generatedPath = new URL(
      "./.generated-content-client.test.ts",
      import.meta.url,
    );
    await writeFile(
      generatedPath,
      generateClient(document, { models: "./models.js" }),
      "utf8",
    );

    try {
      const generatedClient = await import(
        generatedPath.href + `?v=${Date.now()}`
      );
      const requests: RequestInit[] = [];
      const api = generatedClient.createApiClient({
        baseUrl: "http://example.test",
        fetch: async (_input: URL | RequestInfo, init?: RequestInit) => {
          requests.push(init ?? {});
          if (
            init?.headers &&
            new Headers(init.headers).get("content-type") ===
              "application/octet-stream"
          ) {
            return new Response(new Blob(["download"]), {
              status: 200,
              headers: { "content-type": "application/octet-stream" },
            });
          }
          if (
            init?.headers &&
            new Headers(init.headers).get("content-type") ===
              "application/x-www-form-urlencoded"
          ) {
            return new Response("received", {
              status: 200,
              headers: { "content-type": "text/plain" },
            });
          }
          if (
            init?.headers &&
            new Headers(init.headers).get("content-type") === "application/xml"
          ) {
            return new Response("<result>ok</result>", {
              status: 200,
              headers: { "content-type": "application/xml" },
            });
          }
          return new Response(new Blob(["stored"]), {
            status: 201,
            headers: { "content-type": "application/octet-stream" },
          });
        },
      });

      const upload = await api.uploads.create({
        body: {
          title: "report",
          file: new Blob(["file bytes"], { type: "text/plain" }),
          tags: ["one", "two"],
        },
      });
      assert.ok(upload instanceof Blob);
      const multipart = requests[0]!.body as FormData;
      assert.ok(multipart instanceof FormData);
      assert.equal(multipart.get("title"), "report");
      assert.equal((multipart.get("file") as Blob).size, 10);
      assert.deepEqual(multipart.getAll("tags"), ["one", "two"]);
      assert.equal(
        new Headers(requests[0]!.headers).has("content-type"),
        false,
      );

      const formResponse = await api.forms.create({
        body: { search: "term", tags: ["one", "two"] },
      });
      assert.equal(formResponse, "received");
      const urlEncoded = requests[1]!.body as URLSearchParams;
      assert.ok(urlEncoded instanceof URLSearchParams);
      assert.equal(urlEncoded.get("search"), "term");
      assert.deepEqual(urlEncoded.getAll("tags"), ["one", "two"]);

      const binaryResponse = await api.raw.create({
        body: new Uint8Array([1, 2, 3]),
      });
      assert.ok(binaryResponse instanceof Blob);
      assert.deepEqual(
        [...new Uint8Array(await binaryResponse.arrayBuffer())],
        [...new Uint8Array(await new Blob(["download"]).arrayBuffer())],
      );
      assert.ok(requests[2]!.body instanceof Uint8Array);
      assert.equal(
        new Headers(requests[2]!.headers).get("content-type"),
        "application/octet-stream",
      );

      const xmlResponse = await api.xml.create({ body: "<input />" });
      assert.equal(xmlResponse, "<result>ok</result>");
      assert.equal(requests[3]!.body, "<input />");
    } finally {
      await unlink(generatedPath).catch(() => undefined);
    }
  });
});
