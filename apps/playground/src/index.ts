import { defineConfig } from "@restfx/core";
import { HttpServer } from "@restfx/server";
import pino from "pino";
import { PlaygroundApi } from "./api.js";
import { createPlaygroundContainer } from "./services/index.js";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname",
      translateTime: "SYS:standard",
    },
  },
});

const config = defineConfig({ port: Number(process.env.PORT) || 3000 });
const server = new HttpServer(PlaygroundApi, {
  container: createPlaygroundContainer(),
  onRequest: (context) => {
    logger.info(
      {
        event: "http.request",
        requestId: context.requestId,
        method: context.req.method,
        path: context.req.path,
      },
      "HTTP request",
    );
  },
  onError: (error, context) => {
    logger.error(
      {
        err: error,
        event: "http.error",
        requestId: context?.requestId,
      },
      "HTTP request failed",
    );
  },
  onResponse: (context, metrics) => {
    logger.info(
      {
        event: "http.response",
        requestId: context.requestId,
        method: context.req.method,
        path: context.req.path,
        statusCode: metrics.statusCode,
        durationMs: metrics.durationMs,
        completed: metrics.completed,
      },
      "HTTP response",
    );
  },
});

server.listen(config.port, () => {
  logger.info(
    { url: `http://localhost:${config.port}` },
    "Playground API listening",
  );
  logger.info(
    { url: `http://localhost:${config.port}/docs` },
    "Swagger UI API reference",
  );
});
