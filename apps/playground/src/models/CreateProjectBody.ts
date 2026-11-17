import { ArrayOf, Field, Model, StringField } from "@restfx/core";

@Model()
export class CreateProjectBody {
  @Field({ type: StringField, minLength: 3, maxLength: 80 })
  name!: string;

  @Field({ type: StringField, optional: true, maxLength: 500 })
  description?: string;

  @Field({
    type: ArrayOf(StringField),
    optional: true,
    maxItems: 10,
    uniqueItems: true,
  })
  tags?: string[];
}
