import {
  HttpContext,
  HttpDelete,
  HttpGet,
  HttpPatch,
  HttpPost,
  HttpResource,
  HttpResult,
  Inject,
} from "@framework/server";
import {
  CreateProjectRequest,
  CreateTaskRequest,
  ListProjectsRequest,
  ListTasksRequest,
  ProjectPathRequest,
  ProjectResponse,
  TaskPathRequest,
  TaskResponse,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from "./models.js";
import { ProjectService, TaskService, WorkspaceService } from "./services.js";

@HttpResource("workspaces")
export class WorkspacesResource {
  @Inject(WorkspaceService)
  private readonly workspaces!: WorkspaceService;

  @HttpGet({
    summary: "List workspaces",
    operationId: "listWorkspaces",
    tags: ["Workspaces"],
    responses: {
      "200": {
        description: "Available workspaces",
        schema: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "name", "plan", "region"],
            properties: {
              id: { type: "string", format: "uuid" },
              name: { type: "string" },
              plan: { type: "string", enum: ["free", "team", "enterprise"] },
              region: { type: "string" },
            },
          },
        },
      },
    },
  })
  list() {
    return this.workspaces.list();
  }

  @HttpGet({
    path: ":workspaceId",
    summary: "Get a workspace",
    operationId: "getWorkspace",
    tags: ["Workspaces"],
    responses: {
      "404": { description: "Workspace not found" },
    },
  })
  get(context: HttpContext) {
    return (
      this.workspaces.get(context.req.params.workspaceId) ?? new HttpResult(404)
    );
  }

  @HttpResource(":workspaceId/projects")
  readonly projects = new ProjectsResource();
}

@HttpResource()
class ProjectsResource {
  @Inject(ProjectService)
  private readonly projects!: ProjectService;

  @HttpGet({
    summary: "Search workspace projects",
    description:
      "Filter projects by status or name. Repeated status parameters are accepted.",
    operationId: "listProjects",
    tags: ["Projects"],
    request: ListProjectsRequest,
    responses: {
      "200": {
        description: "A page of matching projects",
        schema: {
          type: "object",
          required: ["items", "total", "limit"],
          properties: {
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/ProjectResponse" },
            },
            total: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    },
  })
  async list(context: HttpContext) {
    const request = await context.req.model(ListProjectsRequest);
    return this.projects.list(request) ?? new HttpResult(404);
  }

  @HttpPost({
    summary: "Create a project",
    operationId: "createProject",
    tags: ["Projects"],
    request: CreateProjectRequest,
    response: ProjectResponse,
    responses: {
      "201": { description: "Project created" },
      "404": { description: "Workspace not found" },
      "409": { description: "A project with this name already exists" },
    },
  })
  async create(context: HttpContext) {
    const request = await context.req.model(CreateProjectRequest);
    const project = this.projects.create(request);
    if (project === undefined) return new HttpResult(404);
    if (project === null) return new HttpResult(409);
    return new HttpResult(201, project);
  }

  @HttpResource(":projectId")
  readonly item = new ProjectResource();
}

@HttpResource()
class ProjectResource {
  @Inject(ProjectService)
  private readonly projects!: ProjectService;

  @HttpGet({
    summary: "Get a project",
    operationId: "getProject",
    tags: ["Projects"],
    request: ProjectPathRequest,
    response: ProjectResponse,
    responses: { "404": { description: "Project not found" } },
  })
  async get(context: HttpContext) {
    const { workspaceId, projectId: requestedId } =
      await context.req.model(ProjectPathRequest);
    return this.projects.get(workspaceId, requestedId) ?? new HttpResult(404);
  }

  @HttpPatch({
    summary: "Update a project",
    operationId: "updateProject",
    tags: ["Projects"],
    request: UpdateProjectRequest,
    response: ProjectResponse,
    responses: { "404": { description: "Project not found" } },
  })
  async update(context: HttpContext) {
    const request = await context.req.model(UpdateProjectRequest);
    return this.projects.update(request) ?? new HttpResult(404);
  }

  @HttpDelete({
    summary: "Archive a project",
    operationId: "archiveProject",
    tags: ["Projects"],
    request: ProjectPathRequest,
    responses: {
      "204": { description: "Project archived" },
      "404": { description: "Project not found" },
    },
  })
  async archive(context: HttpContext) {
    const request = await context.req.model(ProjectPathRequest);
    const project = this.projects.archive(
      request.workspaceId,
      request.projectId,
    );
    if (!project) return new HttpResult(404);
    return new HttpResult(204);
  }

  @HttpResource("tasks")
  readonly tasks = new TasksResource();
}

@HttpResource()
class TasksResource {
  @Inject(TaskService)
  private readonly tasks!: TaskService;

  @HttpGet({
    summary: "List project tasks",
    operationId: "listTasks",
    tags: ["Tasks"],
    request: ListTasksRequest,
    responses: {
      "200": {
        description: "Tasks for the project",
        schema: {
          type: "array",
          items: { $ref: "#/components/schemas/TaskResponse" },
        },
      },
      "404": { description: "Project not found" },
    },
  })
  async list(context: HttpContext) {
    const request = await context.req.model(ListTasksRequest);
    return this.tasks.list(request) ?? new HttpResult(404);
  }

  @HttpPost({
    summary: "Create a task",
    operationId: "createTask",
    tags: ["Tasks"],
    request: CreateTaskRequest,
    response: TaskResponse,
    responses: {
      "201": { description: "Task created" },
      "404": { description: "Project not found" },
    },
  })
  async create(context: HttpContext) {
    const request = await context.req.model(CreateTaskRequest);
    const task = this.tasks.create(request);
    if (!task) return new HttpResult(404);
    return new HttpResult(201, task);
  }

  @HttpResource(":taskId")
  readonly item = new TaskResource();
}

@HttpResource()
class TaskResource {
  @Inject(TaskService)
  private readonly tasks!: TaskService;

  @HttpGet({
    summary: "Get a task",
    operationId: "getTask",
    tags: ["Tasks"],
    request: TaskPathRequest,
    response: TaskResponse,
    responses: { "404": { description: "Task not found" } },
  })
  async get(context: HttpContext) {
    const request = await context.req.model(TaskPathRequest);
    return (
      this.tasks.get(request.workspaceId, request.projectId, request.taskId) ??
      new HttpResult(404)
    );
  }

  @HttpPatch({
    summary: "Update a task",
    operationId: "updateTask",
    tags: ["Tasks"],
    request: UpdateTaskRequest,
    response: TaskResponse,
    responses: { "404": { description: "Task not found" } },
  })
  async update(context: HttpContext) {
    const request = await context.req.model(UpdateTaskRequest);
    return this.tasks.update(request) ?? new HttpResult(404);
  }
}
