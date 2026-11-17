import { Enum, Field, IntegerField, Model } from "@framework/core";
import { ProjectPathRequest } from "./ProjectPathRequest.js";

@Model()
export class ListTasksRequest extends ProjectPathRequest {
  @Field({
    type: Enum(["todo", "in-progress", "done"]),
    optional: true,
    source: "query",
  })
  status?: "todo" | "in-progress" | "done";

  @Field({
    type: IntegerField,
    optional: true,
    minimum: 1,
    maximum: 100,
    source: "query",
  })
  limit?: number;
}
