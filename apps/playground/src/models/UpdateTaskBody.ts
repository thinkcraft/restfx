import { Enum, Field, IntegerField, Model, StringField } from "@restfx/core";

@Model()
export class UpdateTaskBody {
  @Field({ type: StringField, optional: true, minLength: 3, maxLength: 120 })
  title?: string;

  @Field({ type: StringField, optional: true, maxLength: 1_000 })
  description?: string;

  @Field({ type: IntegerField, optional: true, minimum: 1, maximum: 5 })
  priority?: number;

  @Field({ type: Enum(["todo", "in-progress", "done"]), optional: true })
  status?: "todo" | "in-progress" | "done";
}
