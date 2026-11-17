import { defineConfig } from "@framework/core";
import { createServer } from "@framework/server";

const config = defineConfig({ port: Number(process.env.PORT) || 3000 });

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Hello from your full-stack framework!\n");
}, config);

server.listen(config.port, () => {
  console.log(`Playground listening at http://localhost:${config.port}`);
});
