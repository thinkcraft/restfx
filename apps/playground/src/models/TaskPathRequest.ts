import { Field, Model, UUID } from "@restfx/core";
import { ProjectPathRequest } from "./ProjectPathRequest.js";

@Model()
export class TaskPathRequest extends ProjectPathRequest {
  @Field({ type: UUID, source: "path" })
  taskId!: string;
}
