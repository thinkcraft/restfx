import { ArrayOf, Field, IntegerField, Model } from "@framework/core";
import { ProjectResponse } from "./ProjectResponse.js";

@Model()
export class ListProjectsResponse {
  @Field({ type: ArrayOf(ProjectResponse) })
  items!: ProjectResponse[];

  @Field({ type: IntegerField, minimum: 0 })
  total!: number;

  @Field({ type: IntegerField, minimum: 1, maximum: 50 })
  limit!: number;
}
