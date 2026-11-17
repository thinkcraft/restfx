import { defineConfig } from "@framework/core";
import { HttpServer } from "@framework/server";
import { PlaygroundApi } from "./api.js";

const config = defineConfig({ port: Number(process.env.PORT) || 3000 });
const server = new HttpServer(PlaygroundApi);

server.listen(config.port);
