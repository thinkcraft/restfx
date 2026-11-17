import { Field, Model, StringField, UUID } from "@restfx/core";

@Model()
export class CreateRecordBody {
  @Field({ type: StringField, minLength: 2 })
  name!: string;

  @Field({ type: StringField, optional: true })
  note?: string;
}

@Model()
export class CreateRecordRequest {
  @Field({ type: UUID, source: "path" })
  id!: string;

  @Field({ model: CreateRecordBody, source: "body" })
  payload!: CreateRecordBody;
}

@Model()
export class RecordResponse {
  @Field({ type: UUID })
  id!: string;
}
