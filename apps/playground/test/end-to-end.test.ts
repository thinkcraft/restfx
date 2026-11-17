import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { ApiError, createApiClient } from "../src/api-client.js";
import { PlaygroundApi } from "../src/api.js";
import { HttpServer } from "@framework/server";
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
    } finally {
      await server.close();
    }
  });
});
