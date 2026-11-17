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
