import { randomUUID } from "node:crypto";
import {
  HttpContext,
  HttpDelete,
  HttpGet,
  HttpPatch,
  HttpPost,
  HttpResource,
  HttpResult,
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

const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const projectId = "550e8400-e29b-41d4-a716-446655440001";
const secondProjectId = "550e8400-e29b-41d4-a716-446655440002";
const taskId = "550e8400-e29b-41d4-a716-446655440003";

const workspaces = [
  {
    id: workspaceId,
    name: "Northstar Studio",
    plan: "enterprise",
    region: "us-west-2",
  },
];

const projects: ProjectResponse[] = [
  {
    id: projectId,
    workspaceId,
    name: "Customer portal",
    description: "Modernize the self-service customer experience.",
    status: "active",
    tags: ["web", "customer-facing"],
  },
  {
    id: secondProjectId,
    workspaceId,
    name: "Usage analytics",
    description: "Usage reporting and export workflows.",
    status: "archived",
    tags: ["data", "reporting"],
  },
];

const tasks: TaskResponse[] = [
  {
    id: taskId,
    projectId,
    title: "Design the account overview",
    description: "Include usage, billing, and recent activity.",
    priority: 2,
    status: "in-progress",
  },
];

@HttpResource("workspaces")
export class WorkspacesResource {
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
    return workspaces;
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
      workspaces.find(
        (workspace) => workspace.id === context.req.params.workspaceId,
      ) ?? new HttpResult(404)
    );
  }

  @HttpResource(":workspaceId/projects")
  readonly projects = new ProjectsResource();
}

@HttpResource()
class ProjectsResource {
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
    if (!workspaces.some((workspace) => workspace.id === request.workspaceId)) {
      return new HttpResult(404);
    }

    const statuses = new Set(request.statuses ?? []);
    const search = request.search?.toLocaleLowerCase();
    const matching = projects.filter(
      (project) =>
        project.workspaceId === request.workspaceId &&
        (statuses.size === 0 || statuses.has(project.status)) &&
        (!search ||
          project.name.toLocaleLowerCase().includes(search) ||
          project.description?.toLocaleLowerCase().includes(search)),
    );
    const limit = request.limit ?? 20;
    return {
      items: matching.slice(0, limit),
      total: matching.length,
      limit,
    };
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
    if (!workspaces.some((workspace) => workspace.id === request.workspaceId)) {
      return new HttpResult(404);
    }
    if (
      projects.some(
        (project) =>
          project.workspaceId === request.workspaceId &&
          project.name.toLocaleLowerCase() ===
            request.body.name.toLocaleLowerCase(),
      )
    ) {
      return new HttpResult(409);
    }

    const project: ProjectResponse = {
      id: randomUUID(),
      workspaceId: request.workspaceId,
      name: request.body.name,
      ...(request.body.description !== undefined
        ? { description: request.body.description }
        : {}),
      status: "active",
      tags: request.body.tags ?? [],
    };
    projects.push(project);
    return new HttpResult(201, project);
  }

  @HttpResource(":projectId")
  readonly item = new ProjectResource();
}

@HttpResource()
class ProjectResource {
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
    return (
      projects.find(
        (project) =>
          project.workspaceId === workspaceId && project.id === requestedId,
      ) ?? new HttpResult(404)
    );
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
    const project = findProject(request.workspaceId, request.projectId);
    if (!project) return new HttpResult(404);

    Object.assign(project, request.body);
    return project;
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
    const project = findProject(request.workspaceId, request.projectId);
    if (!project) return new HttpResult(404);
    project.status = "archived";
    return new HttpResult(204);
  }

  @HttpResource("tasks")
  readonly tasks = new TasksResource();
}

@HttpResource()
class TasksResource {
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
    if (!findProject(request.workspaceId, request.projectId)) {
      return new HttpResult(404);
    }
    const matching = tasks.filter(
      (task) =>
        task.projectId === request.projectId &&
        (!request.status || task.status === request.status),
    );
    return matching.slice(0, request.limit ?? 100);
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
    if (!findProject(request.workspaceId, request.projectId)) {
      return new HttpResult(404);
    }
    const task: TaskResponse = {
      id: randomUUID(),
      projectId: request.projectId,
      title: request.body.title,
      ...(request.body.description !== undefined
        ? { description: request.body.description }
        : {}),
      priority: request.body.priority,
      status: "todo",
    };
    tasks.push(task);
    return new HttpResult(201, task);
  }

  @HttpResource(":taskId")
  readonly item = new TaskResource();
}

@HttpResource()
class TaskResource {
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
    if (!findProject(request.workspaceId, request.projectId)) {
      return new HttpResult(404);
    }
    return (
      tasks.find(
        (task) =>
          task.projectId === request.projectId && task.id === request.taskId,
      ) ?? new HttpResult(404)
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
    if (!findProject(request.workspaceId, request.projectId)) {
      return new HttpResult(404);
    }
    const task = tasks.find(
      (item) =>
        item.projectId === request.projectId && item.id === request.taskId,
    );
    if (!task) return new HttpResult(404);

    Object.assign(task, request.body);
    return task;
  }
}

function findProject(workspaceId: string, projectId: string) {
  return projects.find(
    (project) =>
      project.workspaceId === workspaceId && project.id === projectId,
  );
}
