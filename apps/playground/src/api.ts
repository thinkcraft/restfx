import { HttpGet, HttpResource, OpenApiMiddleware } from "@framework/server";
import { WorkspacesResource } from "./resources/index.js";

@OpenApiMiddleware({
  path: "/openapi.json",
  ui: { type: "swagger", path: "/docs" },
  info: {
    title: "Northstar Project Platform API",
    version: "1.0.0",
    description:
      "A sample multi-tenant project and task API demonstrating nested resources, validated requests, pagination, and modeled responses.",
  },
  tags: [
    { name: "Workspaces", description: "Workspace discovery and settings" },
    {
      name: "Projects",
      description: "Project search and lifecycle operations",
    },
    { name: "Tasks", description: "Tasks nested under workspace projects" },
  ],
})
@HttpResource()
export class PlaygroundApi {
  @HttpGet({
    summary: "Playground API overview",
    tags: ["Meta"],
  })
  getPlaygroundInfo() {
    return {
      name: "Northstar Project Platform API",
      version: "1.0.0",
      docs: "/docs",
      openapi: "/openapi.json",
      exampleWorkspaceId: "550e8400-e29b-41d4-a716-446655440000",
    };
  }

  @HttpGet({
    path: "health",
    summary: "Check API health",
    tags: ["Meta"],
  })
  getHealth() {
    return { healthy: true, timestamp: new Date().toISOString() };
  }

  readonly workspaces = new WorkspacesResource();
}
