import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { ApiError, createApiClient } from "../src/api-client.js";
import { PlaygroundApi } from "../src/api.js";
import { HttpServer } from "@restfx/server";
import { createPlaygroundContainer } from "../src/services/index.js";

const exampleWorkspaceId = "550e8400-e29b-41d4-a716-446655440000";

describe("playground end-to-end API", () => {
  it("keeps OpenAPI, generated client, validation, and server behavior aligned", async () => {
    const server = new HttpServer(PlaygroundApi, {
      container: createPlaygroundContainer(),
    });
    const listeningServer = server.listen(0);
    await once(listeningServer, "listening");
    const address = listeningServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const api = createApiClient({ baseUrl });

    try {
      const openApiResponse = await fetch(`${baseUrl}/openapi.json`);
      assert.equal(openApiResponse.status, 200);
      const openApi = (await openApiResponse.json()) as {
        paths: Record<string, Record<string, unknown>>;
        components?: { schemas?: Record<string, unknown> };
      };
      assert.ok(openApi.paths["/workspaces/{workspaceId}/projects"]?.get);
      assert.ok(openApi.paths["/workspaces/{workspaceId}/projects"]?.post);
      assert.ok(openApi.components?.schemas?.CreateProjectRequest);
      assert.ok(openApi.components?.schemas?.WorkspaceResponse);
      assert.ok(openApi.components?.schemas?.TaskResponse);
      assert.ok(openApi.components?.schemas?.ListProjectsResponse);
      assert.equal(
        (
          openApi.components?.schemas?.ProjectResponse as {
            description: string;
          }
        ).description,
        "A project and its current lifecycle state.",
      );
      assert.deepEqual(openApi.tags, [
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
      ]);
      assert.ok(openApi.components?.schemas?.LoginRequest);
      assert.ok(openApi.components?.schemas?.AuthSessionResponse);
      assert.ok(openApi.paths["/auth/session"]?.post);
      assert.ok(openApi.paths["/auth/session"]?.get);
      assert.ok(openApi.paths["/auth/session"]?.delete);
      assert.deepEqual(
        (
          openApi.paths["/auth/session"]?.post as {
            responses: Record<
              string,
              { headers?: Record<string, { description?: string }> }
            >;
          }
        ).responses["200"]?.headers?.["Set-Cookie"],
        {
          description: "HttpOnly northstar_session cookie for the demo session",
          schema: { type: "string" },
        },
      );
      assert.ok(openApi.paths["/attachments/{attachmentId}"]?.put);
      assert.ok(openApi.paths["/attachments/{attachmentId}"]?.get);
      assert.deepEqual(
        (
          openApi.paths["/attachments/{attachmentId}"]?.put as {
            requestBody: {
              content: Record<string, { schema: unknown }>;
            };
          }
        ).requestBody.content["application/octet-stream"]?.schema,
        { type: "string", format: "binary" },
      );
      assert.deepEqual(
        (
          openApi.paths["/workspaces"]?.get as {
            responses: Record<
              string,
              { content: { "application/json": { schema: unknown } } }
            >;
          }
        ).responses["200"]?.content["application/json"].schema,
        {
          type: "array",
          items: { $ref: "#/components/schemas/WorkspaceResponse" },
        },
      );
      assert.deepEqual(
        (
          openApi.paths["/workspaces/{workspaceId}/projects/{projectId}/tasks"]
            ?.get as {
            responses: Record<
              string,
              { content: { "application/json": { schema: unknown } } }
            >;
          }
        ).responses["200"]?.content["application/json"].schema,
        {
          type: "array",
          items: { $ref: "#/components/schemas/TaskResponse" },
        },
      );
      assert.deepEqual(
        (
          openApi.paths["/workspaces/{workspaceId}/projects"]?.get as {
            responses: Record<
              string,
              { content: { "application/json": { schema: unknown } } }
            >;
          }
        ).responses["200"]?.content["application/json"].schema,
        { $ref: "#/components/schemas/ListProjectsResponse" },
      );
      assert.deepEqual(
        (
          openApi.components?.schemas?.ListProjectsResponse as {
            properties: Record<string, unknown>;
          }
        ).properties.items,
        {
          type: "array",
          items: { $ref: "#/components/schemas/ProjectResponse" },
        },
      );

      const workspacesResponse = await fetch(`${baseUrl}/workspaces`);
      assert.equal(workspacesResponse.status, 200);
      assert.deepEqual(await workspacesResponse.json(), [
        {
          id: exampleWorkspaceId,
          name: "Northstar Studio",
          plan: "enterprise",
          region: "us-west-2",
        },
      ]);

      const projects = await api.workspaces.projects.list({
        workspaceId: exampleWorkspaceId,
        statuses: ["active"],
      });
      assert.equal(projects.items.length, 1);
      assert.equal(projects.items[0]?.name, "Customer portal");

      await assert.rejects(
        api.workspaces.projects.create({
          workspaceId: exampleWorkspaceId,
          body: { name: "x" },
        }),
        /validation failed/i,
      );

      const serverValidation = await fetch(
        `${baseUrl}/workspaces/${exampleWorkspaceId}/projects`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "e2e-invalid-input",
          },
          body: JSON.stringify({ name: "x" }),
        },
      );
      assert.equal(serverValidation.status, 422);
      assert.equal(
        serverValidation.headers.get("x-request-id"),
        "e2e-invalid-input",
      );

      const projectName = `E2E project ${randomUUID()}`;
      const created = await api.workspaces.projects.create({
        workspaceId: exampleWorkspaceId,
        body: { name: projectName, tags: ["e2e"] },
      });
      assert.equal(created.name, projectName);
      assert.equal(created.status, "active");

      await assert.rejects(
        api.workspaces.projects.create({
          workspaceId: exampleWorkspaceId,
          body: { name: projectName },
        }),
        (error: unknown) => error instanceof ApiError && error.status === 409,
      );

      const invalidLogin = await fetch(`${baseUrl}/auth/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "demo@example.test",
          password: "incorrect",
        }),
      });
      assert.equal(invalidLogin.status, 401);
      assert.equal(invalidLogin.headers.get("set-cookie"), null);

      const login = await fetch(`${baseUrl}/auth/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "demo@example.test",
          password: "playground-only",
        }),
      });
      assert.equal(login.status, 200);
      assert.deepEqual(await login.json(), {
        userId: "demo-user",
        email: "demo@example.test",
      });
      const setCookie = login.headers.get("set-cookie");
      assert.ok(setCookie);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      assert.match(setCookie, /Path=\//i);
      const sessionCookie = setCookie.split(";", 1)[0];
      assert.ok(sessionCookie);

      const currentSession = await fetch(`${baseUrl}/auth/session`, {
        headers: { cookie: sessionCookie },
      });
      assert.equal(currentSession.status, 200);
      assert.deepEqual(await currentSession.json(), {
        userId: "demo-user",
        email: "demo@example.test",
      });

      const logout = await fetch(`${baseUrl}/auth/session`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      });
      assert.equal(logout.status, 204);
      assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/i);
      const expiredSession = await fetch(`${baseUrl}/auth/session`, {
        headers: { cookie: sessionCookie },
      });
      assert.equal(expiredSession.status, 401);

      const attachmentId = `e2e-${randomUUID()}`;
      const attachmentBytes = Buffer.from([0x00, 0xff, 0x80, 0x41, 0x00]);
      const upload = await fetch(`${baseUrl}/attachments/${attachmentId}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: attachmentBytes,
      });
      assert.equal(upload.status, 201);
      assert.deepEqual(await upload.json(), {
        id: attachmentId,
        bytes: attachmentBytes.byteLength,
        contentType: "application/octet-stream",
      });

      const download = await fetch(`${baseUrl}/attachments/${attachmentId}`);
      assert.equal(download.status, 200);
      assert.equal(
        download.headers.get("content-type"),
        "application/octet-stream",
      );
      assert.deepEqual(
        Buffer.from(await download.arrayBuffer()),
        attachmentBytes,
      );

      const missingAttachment = await fetch(
        `${baseUrl}/attachments/not-uploaded`,
      );
      assert.equal(missingAttachment.status, 404);

      const oversizedAttachmentId = `e2e-large-${randomUUID()}`;
      const oversizedUpload = await fetch(
        `${baseUrl}/attachments/${oversizedAttachmentId}`,
        {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: Buffer.alloc(5 * 1024 * 1024 + 1),
        },
      );
      assert.equal(oversizedUpload.status, 413);
      const rejectedAttachment = await fetch(
        `${baseUrl}/attachments/${oversizedAttachmentId}`,
      );
      assert.equal(rejectedAttachment.status, 404);
    } finally {
      await server.close();
    }
  });
});
