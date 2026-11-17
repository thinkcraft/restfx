import { Field, Model, StringField } from "@restfx/core";

@Model()
export class LoginRequest {
  @Field({ type: StringField, minLength: 3, maxLength: 254 })
  email!: string;

  @Field({ type: StringField, minLength: 1, maxLength: 128 })
  password!: string;
}
