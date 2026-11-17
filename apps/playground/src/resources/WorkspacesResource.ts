import {
  HttpContext,
  HttpGet,
  HttpResource,
  HttpResult,
  Inject,
} from "@framework/server";
import { WorkspaceResponse } from "../models/WorkspaceResponse.js";
import { WorkspaceService } from "../services/WorkspaceService.js";
import { ProjectsResource } from "./ProjectsResource.js";

@HttpResource("workspaces")
export class WorkspacesResource {
  @Inject(WorkspaceService)
  private readonly workspaces!: WorkspaceService;

  @HttpGet({
    summary: "List workspaces",
    operationId: "listWorkspaces",
    tags: ["Workspaces"],
    response: { arrayOf: WorkspaceResponse },
    responses: {
      "200": {
        description: "Available workspaces",
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
