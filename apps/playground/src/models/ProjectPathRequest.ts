import { Field, Model, UUID } from "@restfx/core";

@Model()
export class ProjectPathRequest {
  @Field({ type: UUID, source: "path" })
  workspaceId!: string;

  @Field({ type: UUID, source: "path" })
  projectId!: string;
}
