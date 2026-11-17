import { Field, Model } from "@framework/core";
import { UpdateTaskBody } from "./UpdateTaskBody.js";
import { TaskPathRequest } from "./TaskPathRequest.js";

@Model()
export class UpdateTaskRequest extends TaskPathRequest {
  @Field({ model: UpdateTaskBody, source: "body" })
  body!: UpdateTaskBody;
}
