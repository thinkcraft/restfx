import { Field, Model, UUID } from "@framework/core";
import { CreateProjectBody } from "./CreateProjectBody.js";

@Model()
export class CreateProjectRequest {
  @Field({ type: UUID, source: "path" })
  workspaceId!: string;

  @Field({
    type: UUID,
    optional: true,
    source: "header",
    sourceName: "idempotency-key",
  })
  idempotencyKey?: string;

  @Field({
    model: CreateProjectBody,
    source: "body",
    description: "Project details and optional initial labels",
  })
  body!: CreateProjectBody;
}
