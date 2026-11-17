import {
  HttpContext,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpResult,
  Inject,
} from "@framework/server";
import { CreateProjectRequest } from "../models/CreateProjectRequest.js";
import { ListProjectsRequest } from "../models/ListProjectsRequest.js";
import { ProjectResponse } from "../models/ProjectResponse.js";
import { ProjectService } from "../services/ProjectService.js";
import { ProjectResource } from "./ProjectResource.js";

@HttpResource()
export class ProjectsResource {
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
