import { Field, Model } from "@restfx/core";
import { UpdateProjectBody } from "./UpdateProjectBody.js";
import { ProjectPathRequest } from "./ProjectPathRequest.js";

@Model()
export class UpdateProjectRequest extends ProjectPathRequest {
  @Field({ model: UpdateProjectBody, source: "body" })
  body!: UpdateProjectBody;
}
