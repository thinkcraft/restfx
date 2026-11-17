import { Field, Model, StringField } from "@restfx/core";

@Model()
export class AttachmentPathRequest {
  @Field({ type: StringField, source: "path", minLength: 1, maxLength: 128 })
  attachmentId!: string;
}
