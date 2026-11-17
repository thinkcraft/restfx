import { HttpGet, HttpResource, OpenApiMiddleware } from "@framework/server";
import {
  AttachmentsResource,
  AuthResource,
  WorkspacesResource,
} from "./resources/index.js";

@OpenApiMiddleware({
  path: "/openapi.json",
  ui: { type: "scalar", path: "/docs" },
  info: {
    title: "Northstar Project Platform API",
    version: "1.0.0",
    description:
      "A sample API demonstrating nested resources, validated requests, cookie sessions, binary attachments, pagination, and modeled responses.",
  },
  securitySchemes: {
    sessionCookie: {
      type: "apiKey",
      in: "cookie",
      name: "northstar_session",
    },
  },
  tags: [
    { name: "Workspaces", description: "Workspace discovery and settings" },
    {
      name: "Projects",
      description: "Project search and lifecycle operations",
    },
    { name: "Tasks", description: "Tasks nested under workspace projects" },
    { name: "Auth", description: "Demo cookie-based session endpoints" },
    {
      name: "Attachments",
      description: "Binary attachment upload and download",
    },
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
  readonly auth = new AuthResource();
  readonly attachments = new AttachmentsResource();
}
