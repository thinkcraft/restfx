import {
  HttpContext,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpResult,
  Inject,
} from "@framework/server";
import { CreateTaskRequest } from "../models/CreateTaskRequest.js";
import { ListTasksRequest } from "../models/ListTasksRequest.js";
import { TaskResponse } from "../models/TaskResponse.js";
import { TaskService } from "../services/TaskService.js";
import { TaskResource } from "./TaskResource.js";

@HttpResource()
export class TasksResource {
  @Inject(TaskService)
  private readonly tasks!: TaskService;

  @HttpGet({
    summary: "List project tasks",
    tags: ["Tasks"],
    request: ListTasksRequest,
    response: { arrayOf: TaskResponse },
    responses: {
      "200": {
        description: "Tasks for the project",
      },
      "404": { description: "Project not found" },
    },
  })
  async listTasks(context: HttpContext) {
    const request = await context.req.model(ListTasksRequest);
    return this.tasks.list(request) ?? new HttpResult(404);
  }

  @HttpPost({
    summary: "Create a task",
    tags: ["Tasks"],
    request: CreateTaskRequest,
    response: TaskResponse,
    responses: {
      "201": { description: "Task created" },
      "404": { description: "Project not found" },
    },
  })
  async createTask(context: HttpContext) {
    const request = await context.req.model(CreateTaskRequest);
    const task = this.tasks.create(request);
    if (!task) return new HttpResult(404);
    return new HttpResult(201, task);
  }

  @HttpResource(":taskId")
  readonly item = new TaskResource();
}
