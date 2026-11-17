import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import {
  ArrayOf,
  Body,
  BooleanField,
  Field,
  HeaderParam,
  HttpContext,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpServer,
  Model,
  OpenApiMiddleware,
  PathParam,
  QueryParam,
  StringField,
  UUID,
} from "../src/index.js";

@Model()
class CreateRequestBody {
  @Field({ type: StringField, minLength: 2 })
  name!: string;
}

@Model()
class CreateRequest {
  @PathParam({ type: UUID })
  userId!: string;

  @QueryParam({ type: BooleanField, optional: true })
  dryRun?: boolean;

  @QueryParam({ type: ArrayOf(StringField), optional: true, name: "tag" })
  tags?: string[];

  @HeaderParam("x-client-id", { type: UUID, optional: true })
  clientId?: string;

  @Body(CreateRequestBody)
  body!: CreateRequestBody;
}

let sameModelInstance = false;

@OpenApiMiddleware({
  path: "/openapi.json",
  info: { title: "Request models", version: "1.0.0" },
})
@HttpResource("users")
class UsersResource {
  @HttpGet({ summary: "List users" })
  list() {
    return [];
  }

  @HttpPost({ path: ":userId", request: CreateRequest })
  async create(context: HttpContext) {
    const first = await context.req.model(CreateRequest);
    const second = await context.req.model(CreateRequest);
    sameModelInstance = first === second;
    return first;
  }
}

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = new HttpServer(UsersResource);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

describe("HTTP request models", () => {
  it("combines path, query, header, and nested body values into a validated model", async () => {
    sameModelInstance = false;
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/users/550e8400-e29b-41d4-a716-446655440000?dryRun=true&tag=one&tag=two`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-client-id": "550e8400-e29b-41d4-a716-446655440001",
          },
          body: JSON.stringify({ name: "Ada" }),
        },
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        dryRun: true,
        tags: ["one", "two"],
        clientId: "550e8400-e29b-41d4-a716-446655440001",
        body: { name: "Ada" },
      });
      assert.equal(sameModelInstance, true);
    });
  });

  it("returns 422 for invalid path, query, header, and body fields", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/users/not-a-uuid?dryRun=yes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-client-id": "also-not-a-uuid",
        },
        body: JSON.stringify({ name: "Ada" }),
      });

      assert.equal(response.status, 422);
      const error = (await response.json()) as {
        message: string;
        details: Array<{ path: string }>;
      };
      assert.equal(error.message, "Request failed model validation");
      assert.deepEqual(error.details.map(({ path }) => path).sort(), [
        "clientId",
        "dryRun",
        "userId",
      ]);
    });
  });

  it("validates the nested body model", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/users/550e8400-e29b-41d4-a716-446655440000`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "A" }),
        },
      );

      assert.equal(response.status, 422);
      const error = (await response.json()) as { message: string };
      assert.equal(error.message, "Request body failed model validation");
    });
  });

  it("generates OpenAPI parameters and the body schema from request metadata", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/openapi.json`);
      assert.equal(response.status, 200);
      const document = (await response.json()) as {
        paths: Record<
          string,
          {
            post: {
              parameters: Array<{
                name: string;
                in: string;
                required: boolean;
                schema: Record<string, unknown>;
              }>;
              requestBody: {
                content: Record<string, { schema: Record<string, unknown> }>;
              };
            };
          }
        >;
      };
      const operation = document.paths["/users/{userId}"]!.post;
      assert.deepEqual(
        operation.parameters.map(({ name, in: location }) => [name, location]),
        [
          ["userId", "path"],
          ["dryRun", "query"],
          ["tag", "query"],
          ["x-client-id", "header"],
        ],
      );
      assert.equal(operation.parameters[0]!.required, true);
      assert.equal(operation.parameters[1]!.required, false);
      assert.deepEqual(operation.parameters[1]!.schema, { type: "boolean" });
      assert.deepEqual(
        operation.requestBody.content["application/json"]!.schema,
        { $ref: "#/components/schemas/CreateRequestBody" },
      );
    });
  });
});
