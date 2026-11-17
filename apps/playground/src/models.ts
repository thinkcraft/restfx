import {
  ArrayOf,
  Body,
  Field,
  HeaderParam,
  IntegerField,
  Model,
  PathParam,
  QueryParam,
  StringField,
  UUID,
} from "@framework/server";

@Model()
export class CreateProjectBody {
  @Field({ type: StringField, minLength: 3, maxLength: 80 })
  name!: string;

  @Field({ type: StringField, optional: true, maxLength: 500 })
  description?: string;

  @Field({
    type: ArrayOf(StringField),
    optional: true,
    maxItems: 10,
    uniqueItems: true,
  })
  tags?: string[];
}

@Model()
export class UpdateProjectBody {
  @Field({ type: StringField, optional: true, minLength: 3, maxLength: 80 })
  name?: string;

  @Field({ type: StringField, optional: true, maxLength: 500 })
  description?: string;

  @Field({ type: StringField, optional: true })
  status?: "active" | "archived";

  @Field({
    type: ArrayOf(StringField),
    optional: true,
    maxItems: 10,
    uniqueItems: true,
  })
  tags?: string[];
}

@Model()
export class CreateTaskBody {
  @Field({ type: StringField, minLength: 3, maxLength: 120 })
  title!: string;

  @Field({ type: StringField, optional: true, maxLength: 1_000 })
  description?: string;

  @Field({ type: IntegerField, minimum: 1, maximum: 5 })
  priority!: number;
}

@Model()
export class UpdateTaskBody {
  @Field({ type: StringField, optional: true, minLength: 3, maxLength: 120 })
  title?: string;

  @Field({ type: StringField, optional: true, maxLength: 1_000 })
  description?: string;

  @Field({ type: IntegerField, optional: true, minimum: 1, maximum: 5 })
  priority?: number;

  @Field({ type: StringField, optional: true })
  status?: "todo" | "in-progress" | "done";
}

@Model()
export class ListProjectsRequest {
  @PathParam({ type: UUID })
  workspaceId!: string;

  @QueryParam({ type: StringField, optional: true })
  search?: string;

  @QueryParam({ type: ArrayOf(StringField), optional: true, name: "status" })
  statuses?: string[];

  @QueryParam({ type: IntegerField, optional: true, minimum: 1, maximum: 50 })
  limit?: number;
}

@Model()
export class CreateProjectRequest {
  @PathParam({ type: UUID })
  workspaceId!: string;

  @HeaderParam("idempotency-key", { type: UUID, optional: true })
  idempotencyKey?: string;

  @Body(CreateProjectBody, {
    description: "Project details and optional initial labels",
  })
  body!: CreateProjectBody;
}

@Model()
export class ProjectPathRequest {
  @PathParam({ type: UUID })
  workspaceId!: string;

  @PathParam({ type: UUID })
  projectId!: string;
}

@Model()
export class UpdateProjectRequest extends ProjectPathRequest {
  @Body(UpdateProjectBody)
  body!: UpdateProjectBody;
}

@Model()
export class ListTasksRequest extends ProjectPathRequest {
  @QueryParam({ type: StringField, optional: true })
  status?: string;

  @QueryParam({ type: IntegerField, optional: true, minimum: 1, maximum: 100 })
  limit?: number;
}

@Model()
export class CreateTaskRequest extends ProjectPathRequest {
  @HeaderParam("x-client-version", { type: StringField, optional: true })
  clientVersion?: string;

  @Body(CreateTaskBody)
  body!: CreateTaskBody;
}

@Model()
export class TaskPathRequest extends ProjectPathRequest {
  @PathParam({ type: UUID })
  taskId!: string;
}

@Model()
export class UpdateTaskRequest extends TaskPathRequest {
  @Body(UpdateTaskBody)
  body!: UpdateTaskBody;
}

@Model()
export class ProjectResponse {
  @Field({ type: UUID, description: "Stable project identifier" })
  id!: string;

  @Field({ type: UUID })
  workspaceId!: string;

  @Field({ type: StringField, minLength: 3, maxLength: 80 })
  name!: string;

  @Field({ type: StringField, optional: true })
  description?: string;

  @Field({
    type: StringField,
    schema: { type: "string", enum: ["active", "archived"] },
  })
  status!: "active" | "archived";

  @Field({ type: ArrayOf(StringField), maxItems: 10, uniqueItems: true })
  tags!: string[];
}

@Model()
export class TaskResponse {
  @Field({ type: UUID })
  id!: string;

  @Field({ type: UUID })
  projectId!: string;

  @Field({ type: StringField })
  title!: string;

  @Field({ type: StringField, optional: true })
  description?: string;

  @Field({ type: IntegerField, minimum: 1, maximum: 5 })
  priority!: number;

  @Field({
    type: StringField,
    schema: { type: "string", enum: ["todo", "in-progress", "done"] },
  })
  status!: "todo" | "in-progress" | "done";
}
