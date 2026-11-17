import { Field, IntegerField, Model, StringField } from "@restfx/core";

@Model()
export class CreateTaskBody {
  @Field({ type: StringField, minLength: 3, maxLength: 120 })
  title!: string;

  @Field({ type: StringField, optional: true, maxLength: 1_000 })
  description?: string;

  @Field({ type: IntegerField, minimum: 1, maximum: 5 })
  priority!: number;
}
