import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import {
  HttpContext,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpServer,
  OpenApiMiddleware,
} from "../src";
import {
  ArrayOf,
  BooleanField,
  DateField,
  DateTimeField,
  DiscriminatedUnion,
  Enum,
  Field,
  Model,
  NumberField,
  StringField,
  TimeField,
  UnionOf,
  UUID,
} from "@framework/core";

@Model()
class CreateRequestBody {
  @Field({ type: StringField, minLength: 2 })
  name!: string;

  @Field({ type: Enum(["active", "archived"]), optional: true })
  status?: "active" | "archived";
}

@Model()
class CreateRequest {
  @Field({ type: UUID, source: "path" })
  userId!: string;

  @Field({ type: BooleanField, optional: true, source: "query" })
  dryRun?: boolean;

  @Field({
    type: ArrayOf(StringField),
    optional: true,
    source: "query",
    sourceName: "tag",
  })
  tags?: string[];

  @Field({
    type: UUID,
    optional: true,
    source: "header",
    sourceName: "x-client-id",
  })
  clientId?: string;

  @Field({ model: CreateRequestBody, source: "body" })
  body!: CreateRequestBody;
}

@Model()
class CatEvent {
  @Field({ type: Enum(["cat"]) })
  kind!: "cat";

  @Field({ type: StringField })
  name!: string;
}

@Model()
class DogEvent {
  @Field({ type: Enum(["dog"]) })
  kind!: "dog";

  @Field({ type: BooleanField })
  friendly!: boolean;
}

@Model()
class BaseEventOwner {
  @Field({ type: StringField })
  name!: string;
}

@Model()
class EventOwner extends BaseEventOwner {
  @Field({ type: StringField })
  role!: string;
}

type EventData = {
  date: string;
  time: string;
  timestamp: string;
  value: number | string;
  pet: CatEvent | DogEvent;
  owner: EventOwner;
  start: number;
  end: number;
};

@Model<EventData>({
  description: "A dated event with an owner and an ordered numeric range.",
  schema: { dependentRequired: { start: ["end"] } },
  validate: (event) =>
    event.start <= event.end
      ? undefined
      : { path: "end", message: "Must not be before start" },
})
class EventModel {
  @Field({ type: DateField })
  date!: string;

  @Field({ type: TimeField })
  time!: string;

  @Field({ type: DateTimeField })
  timestamp!: string;

  @Field({ type: UnionOf(StringField, NumberField) })
  value!: number | string;

  @Field({ type: DiscriminatedUnion("kind", { cat: CatEvent, dog: DogEvent }) })
  pet!: CatEvent | DogEvent;

  @Field({ model: EventOwner })
  owner!: EventOwner;

  @Field({ type: NumberField })
  start!: number;

  @Field({ type: NumberField })
  end!: number;
}

let sameModelInstance = false;

@OpenApiMiddleware({
  path: "/openapi.json",
  info: { title: "Request models", version: "1.0.0" },
})
@HttpResource({
  path: "users",
  tag: "Users",
  description: "User and event operations.",
})
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

  @HttpPost({ path: "event", body: EventModel })
  async createEvent(context: HttpContext) {
    return await context.req.parseBody<EventModel>({ model: EventModel });
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
  it("describes formats and union models in OpenAPI and validates them at runtime", async () => {
    await withServer(async (baseUrl) => {
      const documentResponse = await fetch(`${baseUrl}/openapi.json`);
      const document = (await documentResponse.json()) as any;
      const eventSchema = document.components.schemas.EventModel;
      assert.equal(
        eventSchema.description,
        "A dated event with an owner and an ordered numeric range.",
      );
      assert.deepEqual(document.tags, [
        { name: "Users", description: "User and event operations." },
      ]);
      assert.equal(eventSchema.properties.date.format, "date");
      assert.equal(eventSchema.properties.time.format, "time");
      assert.equal(eventSchema.properties.timestamp.format, "date-time");
      assert.deepEqual(eventSchema.properties.value, {
        anyOf: [{ type: "string" }, { type: "number" }],
      });
      assert.deepEqual(eventSchema.properties.pet, {
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
      });
      assert.deepEqual(eventSchema.properties.owner, {
        $ref: "#/components/schemas/EventOwner",
      });
      assert.deepEqual(document.components.schemas.EventOwner.properties, {
        name: { type: "string" },
        role: { type: "string" },
      });
      assert.deepEqual(document.components.schemas.EventOwner.required, [
        "name",
        "role",
      ]);
      assert.deepEqual(eventSchema.dependentRequired, { start: ["end"] });

      const valid = await fetch(`${baseUrl}/users/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: "2024-02-29",
          time: "12:30:00Z",
          timestamp: "2024-02-29T12:30:00Z",
          value: 42,
          pet: { kind: "cat", name: "Mochi", extra: true },
          owner: { name: "Ada", role: "organizer" },
          start: 1,
          end: 2,
        }),
      });
      assert.equal(valid.status, 200);
      const body = await valid.json();
      assert.deepEqual(body.pet, { kind: "cat", name: "Mochi" });
      assert.deepEqual(body.owner, { name: "Ada", role: "organizer" });

      const invalid = await fetch(`${baseUrl}/users/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: "2024-02-30",
          time: "12:30:00Z",
          timestamp: "2024-02-29T12:30:00Z",
          value: 42,
          pet: { kind: "dog", friendly: true },
          owner: { name: "Ada", role: "organizer" },
          start: 3,
          end: 2,
        }),
      });
      assert.equal(invalid.status, 422);
      const failure = await invalid.json();
      assert.deepEqual(
        failure.details.map((issue: { path: string }) => issue.path),
        ["date"],
      );

      const invalidRange = await fetch(`${baseUrl}/users/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: "2024-02-29",
          time: "12:30:00Z",
          timestamp: "2024-02-29T12:30:00Z",
          value: 42,
          pet: { kind: "dog", friendly: true },
          owner: { name: "Ada", role: "organizer" },
          start: 3,
          end: 2,
        }),
      });
      assert.equal(invalidRange.status, 422);
      const rangeFailure = await invalidRange.json();
      assert.deepEqual(
        rangeFailure.details.map((issue: { path: string }) => issue.path),
        ["end"],
      );
    });
  });

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
        components: {
          schemas: Record<string, { properties: Record<string, unknown> }>;
        };
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
              "x-framework-client": {
                requestModel: { $ref: string };
                fields: Array<{
                  property: string;
                  source: string;
                  name: string;
                }>;
                body: { property: string; model: { $ref: string } };
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
      assert.deepEqual(
        document.components.schemas.CreateRequestBody!.properties.status,
        { type: "string", enum: ["active", "archived"] },
      );
      assert.deepEqual(operation["x-framework-client"], {
        requestModel: { $ref: "#/components/schemas/CreateRequest" },
        fields: [
          { property: "userId", source: "path", name: "userId" },
          { property: "dryRun", source: "query", name: "dryRun" },
          { property: "tags", source: "query", name: "tag" },
          { property: "clientId", source: "header", name: "x-client-id" },
        ],
        body: {
          property: "body",
          model: { $ref: "#/components/schemas/CreateRequestBody" },
        },
      });
    });
  });
});
