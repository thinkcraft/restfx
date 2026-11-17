import {
  Enum,
  Field,
  IntegerField,
  Model,
  StringField,
  UUID,
} from "@restfx/core";

@Model()
export class TaskResponse {
  @Field({ type: UUID })
  id!: string;

  @Field({ type: UUID })
  projectId!: string;

  @Field({ type: StringField })
  title!: string;

  @Field({ type: StringField, optional: true })
  description?: string;

  @Field({ type: IntegerField, minimum: 1, maximum: 5 })
  priority!: number;

  @Field({ type: Enum(["todo", "in-progress", "done"]) })
  status!: "todo" | "in-progress" | "done";
}
