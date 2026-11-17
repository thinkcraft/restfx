import { randomUUID } from "node:crypto";
import { Inject } from "@restfx/server";
import type { CreateProjectRequest } from "../models/CreateProjectRequest.js";
import type { ListProjectsRequest } from "../models/ListProjectsRequest.js";
import type { ProjectResponse } from "../models/ProjectResponse.js";
import type { UpdateProjectRequest } from "../models/UpdateProjectRequest.js";
import { WorkspaceService } from "./WorkspaceService.js";

const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const projectId = "550e8400-e29b-41d4-a716-446655440001";
const secondProjectId = "550e8400-e29b-41d4-a716-446655440002";

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
