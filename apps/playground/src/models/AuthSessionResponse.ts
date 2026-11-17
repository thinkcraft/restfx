import { Field, Model, StringField } from "@restfx/core";

@Model()
export class AuthSessionResponse {
  @Field({ type: StringField })
  userId!: string;

  @Field({ type: StringField })
  email!: string;
}
