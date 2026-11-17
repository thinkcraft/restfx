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

@HttpResource({
  path: "workspaces",
  tag: "Workspaces",
  description: "Workspace discovery and settings",
})
export class WorkspacesResource {
  @Inject(WorkspaceService)
  private readonly workspaces!: WorkspaceService;

  @HttpGet({
    summary: "List workspaces",
    tags: ["Workspaces"],
    response: { arrayOf: WorkspaceResponse },
    responses: {
      "200": {
        description: "Available workspaces",
      },
    },
  })
  listWorkspaces() {
    return this.workspaces.list();
  }

  @HttpGet({
    path: ":workspaceId",
    summary: "Get a workspace",
    tags: ["Workspaces"],
    responses: {
      "404": { description: "Workspace not found" },
    },
  })
  getWorkspace(context: HttpContext) {
    return (
      this.workspaces.get(context.req.params.workspaceId) ?? new HttpResult(404)
    );
  }

  @HttpResource(":workspaceId/projects")
  readonly projects = new ProjectsResource();
}
