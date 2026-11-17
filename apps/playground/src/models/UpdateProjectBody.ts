import { ArrayOf, Enum, Field, Model, StringField } from "@restfx/core";

@Model()
export class UpdateProjectBody {
  @Field({ type: StringField, optional: true, minLength: 3, maxLength: 80 })
  name?: string;

  @Field({ type: StringField, optional: true, maxLength: 500 })
  description?: string;

  @Field({ type: Enum(["active", "archived"]), optional: true })
  status?: "active" | "archived";

  @Field({
    type: ArrayOf(StringField),
    optional: true,
    maxItems: 10,
    uniqueItems: true,
  })
  tags?: string[];
}
