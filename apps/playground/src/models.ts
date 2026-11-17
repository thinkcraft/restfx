import {
  ArrayOf,
  Enum,
  Field,
  IntegerField,
  Model,
  StringField,
  UUID,
} from "@framework/core";

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

  @Field({ type: Enum(["active", "archived"]), optional: true })
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

  @Field({ type: Enum(["todo", "in-progress", "done"]), optional: true })
  status?: "todo" | "in-progress" | "done";
}

@Model()
export class ListProjectsRequest {
  @Field({ type: UUID, source: "path" })
  workspaceId!: string;

  @Field({ type: StringField, optional: true, source: "query" })
  search?: string;

  @Field({
    type: ArrayOf(Enum(["active", "archived"])),
    optional: true,
    source: "query",
    sourceName: "status",
  })
  statuses?: ("active" | "archived")[];

  @Field({
    type: IntegerField,
    optional: true,
    minimum: 1,
    maximum: 50,
    source: "query",
  })
  limit?: number;
}

@Model()
export class CreateProjectRequest {
  @Field({ type: UUID, source: "path" })
  workspaceId!: string;

  @Field({
    type: UUID,
    optional: true,
    source: "header",
    sourceName: "idempotency-key",
  })
  idempotencyKey?: string;

  @Field({
    model: CreateProjectBody,
    source: "body",
    description: "Project details and optional initial labels",
  })
  body!: CreateProjectBody;
}

@Model()
export class ProjectPathRequest {
  @Field({ type: UUID, source: "path" })
  workspaceId!: string;

  @Field({ type: UUID, source: "path" })
  projectId!: string;
}

@Model()
export class UpdateProjectRequest extends ProjectPathRequest {
  @Field({ model: UpdateProjectBody, source: "body" })
  body!: UpdateProjectBody;
}

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

@Model()
export class TaskPathRequest extends ProjectPathRequest {
  @Field({ type: UUID, source: "path" })
  taskId!: string;
}

@Model()
export class UpdateTaskRequest extends TaskPathRequest {
  @Field({ model: UpdateTaskBody, source: "body" })
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

  @Field({ type: Enum(["active", "archived"]) })
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

  @Field({ type: Enum(["todo", "in-progress", "done"]) })
  status!: "todo" | "in-progress" | "done";
}
