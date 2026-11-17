import { randomUUID } from "node:crypto";
import { Inject } from "@framework/server";
import type { CreateTaskRequest } from "../models/CreateTaskRequest.js";
import type { ListTasksRequest } from "../models/ListTasksRequest.js";
import type { TaskResponse } from "../models/TaskResponse.js";
import type { UpdateTaskRequest } from "../models/UpdateTaskRequest.js";
import { ProjectService } from "./ProjectService.js";

const projectId = "550e8400-e29b-41d4-a716-446655440001";
const taskId = "550e8400-e29b-41d4-a716-446655440003";

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
