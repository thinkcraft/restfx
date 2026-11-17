import { Field, Model, UUID } from "@framework/core";
import { ProjectPathRequest } from "./ProjectPathRequest.js";

@Model()
export class TaskPathRequest extends ProjectPathRequest {
  @Field({ type: UUID, source: "path" })
  taskId!: string;
}
