import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { HttpServer } from "@restfx/server";
import { generateClient } from "@restfx/client";
import { PlaygroundApi } from "../src/api.js";
import { createPlaygroundContainer } from "../src/services/index.js";

const server = new HttpServer(PlaygroundApi, {
  container: createPlaygroundContainer(),
});
const listeningServer = server.listen(0);

try {
  await once(listeningServer, "listening");
  const address = listeningServer.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/openapi.json`);
  if (!response.ok) {
    throw new Error(`Could not fetch OpenAPI document (${response.status})`);
  }

  const document = await response.json();
  const client = generateClient(document, { models: "./models/index.js" });
  await writeFile(new URL("../src/api-client.ts", import.meta.url), client);
  console.log("Generated playground API client: src/api-client.ts");
} finally {
  await server.close();
}
