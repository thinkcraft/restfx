import {
  HttpContext,
  HttpGet,
  HttpPatch,
  HttpResource,
  HttpResult,
  Inject,
} from "@restfx/server";
import { TaskPathRequest } from "../models/TaskPathRequest.js";
import { TaskResponse } from "../models/TaskResponse.js";
import { UpdateTaskRequest } from "../models/UpdateTaskRequest.js";
import { TaskService } from "../services/TaskService.js";

@HttpResource()
export class TaskResource {
  @Inject(TaskService)
  private readonly tasks!: TaskService;

  @HttpGet({
    summary: "Get a task",
    tags: ["Tasks"],
    request: TaskPathRequest,
    response: TaskResponse,
    responses: { "404": { description: "Task not found" } },
  })
  async getTask(context: HttpContext) {
    const request = await context.req.model(TaskPathRequest);
    return (
      this.tasks.get(request.workspaceId, request.projectId, request.taskId) ??
      new HttpResult(404)
    );
  }

  @HttpPatch({
    summary: "Update a task",
    tags: ["Tasks"],
    request: UpdateTaskRequest,
    response: TaskResponse,
    responses: { "404": { description: "Task not found" } },
  })
  async updateTask(context: HttpContext) {
    const request = await context.req.model(UpdateTaskRequest);
    return this.tasks.update(request) ?? new HttpResult(404);
  }
}
