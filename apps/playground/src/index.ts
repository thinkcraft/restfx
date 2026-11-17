import { defineConfig } from "@framework/core";
import { HttpGet, HttpResource, HttpServer } from "@framework/server";

const config = defineConfig({ port: Number(process.env.PORT) || 3000 });

@HttpResource()
class API {
  @HttpGet()
  hello() {
    return "Hello from your full-stack framework!";
  }
}

const server = new HttpServer(API);

server.listen(config.port);
