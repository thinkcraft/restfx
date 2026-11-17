import { Field, Model, StringField } from "@restfx/core";
import { CreateTaskBody } from "./CreateTaskBody.js";
import { ProjectPathRequest } from "./ProjectPathRequest.js";

@Model()
export class CreateTaskRequest extends ProjectPathRequest {
  @Field({
    type: StringField,
    optional: true,
    source: "header",
    sourceName: "x-client-version",
  })
  clientVersion?: string;

  @Field({ model: CreateTaskBody, source: "body" })
  body!: CreateTaskBody;
}
