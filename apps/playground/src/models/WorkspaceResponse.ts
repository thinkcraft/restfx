import { Enum, Field, Model, StringField, UUID } from "@framework/core";

@Model()
export class WorkspaceResponse {
  @Field({ type: UUID })
  id!: string;

  @Field({ type: StringField })
  name!: string;

  @Field({ type: Enum(["free", "team", "enterprise"]) })
  plan!: "free" | "team" | "enterprise";

  @Field({ type: StringField })
  region!: string;
}
