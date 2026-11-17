import {
  ArrayOf,
  Enum,
  Field,
  IntegerField,
  Model,
  StringField,
  UUID,
} from "@restfx/core";

@Model()
export class ListProjectsRequest {
  @Field({ type: UUID, source: "path" })
  workspaceId!: string;

  @Field({ type: StringField, optional: true, source: "query" })
  search?: string;

  @Field({
    type: ArrayOf(Enum(["active", "archived"])),
    optional: true,
    source: "query",
    sourceName: "status",
  })
  statuses?: ("active" | "archived")[];

  @Field({
    type: IntegerField,
    optional: true,
    minimum: 1,
    maximum: 50,
    source: "query",
  })
  limit?: number;
}
