import { defineConfig } from "@framework/core";
import { HttpServer } from "@framework/server";
import { PlaygroundApi } from "./api.js";
import { createPlaygroundContainer } from "./services.js";

const config = defineConfig({ port: Number(process.env.PORT) || 3000 });
const server = new HttpServer(PlaygroundApi, {
  container: createPlaygroundContainer(),
  onRequest: (context) => {
    console.log(
      JSON.stringify({
        event: "http.request",
        requestId: context.requestId,
        method: context.req.method,
        path: context.req.path,
      }),
    );
  },
  onError: (_error, context) => {
    console.log(
      JSON.stringify({
        event: "http.error",
        requestId: context?.requestId,
      }),
    );
  },
  onResponse: (context, metrics) => {
    console.log(
      JSON.stringify({
        event: "http.response",
        requestId: context.requestId,
        method: context.req.method,
        path: context.req.path,
        statusCode: metrics.statusCode,
        durationMs: metrics.durationMs,
        completed: metrics.completed,
      }),
    );
  },
});

server.listen(config.port, () => {
  console.log(`Playground API listening at http://localhost:${config.port}`);
  console.log(`Swagger UI API reference: http://localhost:${config.port}/docs`);
});
