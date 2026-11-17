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
});
