import { ArrayOf, Enum, Field, Model, StringField, UUID } from "@restfx/core";

@Model({ description: "A project and its current lifecycle state." })
export class ProjectResponse {
  @Field({ type: UUID, description: "Stable project identifier" })
  id!: string;

  @Field({ type: UUID })
  workspaceId!: string;

  @Field({ type: StringField, minLength: 3, maxLength: 80 })
  name!: string;

  @Field({ type: StringField, optional: true })
  description?: string;

  @Field({ type: Enum(["active", "archived"]) })
  status!: "active" | "archived";

  @Field({ type: ArrayOf(StringField), maxItems: 10, uniqueItems: true })
  tags!: string[];
}
