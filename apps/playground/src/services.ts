import { randomUUID } from "node:crypto";
import { Inject, IocContainer } from "@framework/server";
import {
  CreateProjectRequest,
  CreateTaskRequest,
  ListProjectsRequest,
  ListTasksRequest,
  ProjectResponse,
  TaskResponse,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from "./models.js";

const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const projectId = "550e8400-e29b-41d4-a716-446655440001";
const secondProjectId = "550e8400-e29b-41d4-a716-446655440002";
const taskId = "550e8400-e29b-41d4-a716-446655440003";

export class WorkspaceService {
  private readonly workspaces = [
    {
      id: workspaceId,
      name: "Northstar Studio",
      plan: "enterprise",
      region: "us-west-2",
    },
  ];

  list() {
    return this.workspaces;
  }

  get(id: string) {
    return this.workspaces.find((workspace) => workspace.id === id);
  }
}

export class ProjectService {
  @Inject(WorkspaceService)
  private readonly workspaces!: WorkspaceService;

  private readonly projects: ProjectResponse[] = [
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

  list(request: ListProjectsRequest) {
    if (!this.workspaces.get(request.workspaceId)) return undefined;

    const statuses = new Set(request.statuses ?? []);
    const search = request.search?.toLocaleLowerCase();
    const matching = this.projects.filter(
      (project) =>
        project.workspaceId === request.workspaceId &&
        (statuses.size === 0 || statuses.has(project.status)) &&
        (!search ||
          project.name.toLocaleLowerCase().includes(search) ||
          project.description?.toLocaleLowerCase().includes(search)),
    );
    const limit = request.limit ?? 20;
    return { items: matching.slice(0, limit), total: matching.length, limit };
  }

  create(request: CreateProjectRequest) {
    if (!this.workspaces.get(request.workspaceId)) return undefined;
    if (
      this.projects.some(
        (project) =>
          project.workspaceId === request.workspaceId &&
          project.name.toLocaleLowerCase() ===
            request.body.name.toLocaleLowerCase(),
      )
    ) {
      return null;
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
    this.projects.push(project);
    return project;
  }

  get(workspaceId: string, projectId: string) {
    return this.projects.find(
      (project) =>
        project.workspaceId === workspaceId && project.id === projectId,
    );
  }

  update(request: UpdateProjectRequest) {
    const project = this.get(request.workspaceId, request.projectId);
    if (project) Object.assign(project, request.body);
    return project;
  }

  archive(workspaceId: string, projectId: string) {
    const project = this.get(workspaceId, projectId);
    if (project) project.status = "archived";
    return project;
  }
}

export class TaskService {
  @Inject(ProjectService)
  private readonly projects!: ProjectService;

  private readonly tasks: TaskResponse[] = [
    {
      id: taskId,
      projectId,
      title: "Design the account overview",
      description: "Include usage, billing, and recent activity.",
      priority: 2,
      status: "in-progress",
    },
  ];

  list(request: ListTasksRequest) {
    if (!this.projects.get(request.workspaceId, request.projectId)) {
      return undefined;
    }
    return this.tasks
      .filter(
        (task) =>
          task.projectId === request.projectId &&
          (!request.status || task.status === request.status),
      )
      .slice(0, request.limit ?? 100);
  }

  create(request: CreateTaskRequest) {
    if (!this.projects.get(request.workspaceId, request.projectId)) {
      return undefined;
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
    this.tasks.push(task);
    return task;
  }

  get(workspaceId: string, projectId: string, taskId: string) {
    if (!this.projects.get(workspaceId, projectId)) return undefined;
    return this.tasks.find(
      (task) => task.projectId === projectId && task.id === taskId,
    );
  }

  update(request: UpdateTaskRequest) {
    if (!this.projects.get(request.workspaceId, request.projectId)) {
      return undefined;
    }
    const task = this.tasks.find(
      (item) =>
        item.projectId === request.projectId && item.id === request.taskId,
    );
    if (task) Object.assign(task, request.body);
    return task;
  }
}

export function createPlaygroundContainer() {
  return new IocContainer()
    .registerSingleton(WorkspaceService, () => new WorkspaceService())
    .registerSingleton(ProjectService, () => new ProjectService())
    .registerSingleton(TaskService, () => new TaskService());
}
