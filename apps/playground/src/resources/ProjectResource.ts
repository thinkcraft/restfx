import {
  HttpContext,
  HttpDelete,
  HttpGet,
  HttpPatch,
  HttpResource,
  HttpResult,
  Inject,
} from "@restfx/server";
import { ProjectPathRequest } from "../models/ProjectPathRequest.js";
import { ProjectResponse } from "../models/ProjectResponse.js";
import { UpdateProjectRequest } from "../models/UpdateProjectRequest.js";
import { ProjectService } from "../services/ProjectService.js";
import { TasksResource } from "./TasksResource.js";

@HttpResource()
export class ProjectResource {
  @Inject(ProjectService)
  private readonly projects!: ProjectService;

  @HttpGet({
    summary: "Get a project",
    tags: ["Projects"],
    request: ProjectPathRequest,
    response: ProjectResponse,
    responses: { "404": { description: "Project not found" } },
  })
  async getProject(context: HttpContext) {
    const { workspaceId, projectId: requestedId } =
      await context.req.model(ProjectPathRequest);
    return this.projects.get(workspaceId, requestedId) ?? new HttpResult(404);
  }

  @HttpPatch({
    summary: "Update a project",
    tags: ["Projects"],
    request: UpdateProjectRequest,
    response: ProjectResponse,
    responses: { "404": { description: "Project not found" } },
  })
  async updateProject(context: HttpContext) {
    const request = await context.req.model(UpdateProjectRequest);
    return this.projects.update(request) ?? new HttpResult(404);
  }

  @HttpDelete({
    summary: "Archive a project",
    tags: ["Projects"],
    request: ProjectPathRequest,
    responses: {
      "204": { description: "Project archived" },
      "404": { description: "Project not found" },
    },
  })
  async archiveProject(context: HttpContext) {
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
