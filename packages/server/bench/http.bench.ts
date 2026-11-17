import { once } from "node:events";
import { request as httpRequest, Agent } from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import {
  HttpContext,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpServer,
} from "../src";

const iterations = readPositiveInteger("BENCH_ITERATIONS", 1_000);
const samples = readPositiveInteger("BENCH_SAMPLES", 3);
const warmupIterations = readInteger("BENCH_WARMUP", 100, 0);

class ParsingResource {
  @HttpPost("json")
  async json(context: HttpContext) {
    return context.req.parseBody<Record<string, unknown>>();
  }

  @HttpPost("form")
  async form(context: HttpContext) {
    return context.req.parseBody<Record<string, unknown>>();
  }

  @HttpPost("binary")
  async binary(context: HttpContext) {
    const body = await context.req.parseBody<Buffer>();
    return { bytes: body.byteLength };
  }

  @HttpPost("multipart")
  async multipart(context: HttpContext) {
    const body = await context.req.parseBody<{
      note: string;
      upload: { filename: string; data: Buffer };
    }>();
    return {
      note: body.note,
      filename: body.upload.filename,
      bytes: body.upload.data.byteLength,
    };
  }
}

class ResponseResource {
  private readonly binaryBody = Buffer.alloc(16 * 1024, 0x62);

  @HttpGet("json")
  json() {
    return {
      ok: true,
      values: Array.from({ length: 64 }, (_, index) => index),
    };
  }

  @HttpGet("text")
  text() {
    return "benchmark response ".repeat(256);
  }

  @HttpGet("binary")
  binary() {
    return this.binaryBody;
  }

  @HttpGet("stream")
  async *stream() {
    const chunk = "s".repeat(1_024);
    for (let index = 0; index < 16; index++) yield chunk;
  }

  @HttpGet("stream-single")
  async *streamSingle() {
    yield "s".repeat(16 * 1_024);
  }
}

class IssueResource {
  @HttpGet()
  get(context: HttpContext) {
    return {
      tenantId: context.req.params.tenantId,
      projectId: context.req.params.projectId,
      issueId: context.req.params.issueId,
    };
  }
}

class ProjectsResource {
  @HttpResource(":projectId")
  readonly project = new ProjectResource();
}

class ProjectResource {
  @HttpResource("issues")
  readonly issues = new IssuesResource();
}

class IssuesResource {
  @HttpResource(":issueId")
  readonly issue = new IssueResource();
}

class TenantsResource {
  @HttpResource(":tenantId")
  readonly tenant = new TenantResource();
}

class TenantResource {
  @HttpResource("projects")
  readonly projects = new ProjectsResource();
}

class VersionResource {
  @HttpResource("tenants")
  readonly tenants = new TenantsResource();
}

@HttpResource("bench")
class BenchmarkResource {
  @HttpResource("parse")
  readonly parsing = new ParsingResource();

  @HttpResource("response")
  readonly responses = new ResponseResource();

  @HttpResource("v1")
  readonly v1 = new VersionResource();
}

interface Scenario {
  name: string;
  method: string;
  path: string;
  contentType?: string;
  body?: Buffer;
}

const multipartBoundary = "framework-benchmark-boundary";
const multipartBody = Buffer.from(
  `--${multipartBoundary}\r\n` +
    'Content-Disposition: form-data; name="note"\r\n\r\n' +
    "end-to-end benchmark\r\n" +
    `--${multipartBoundary}\r\n` +
    'Content-Disposition: form-data; name="upload"; filename="sample.bin"\r\n' +
    "Content-Type: application/octet-stream\r\n\r\n" +
    "x".repeat(4_096) +
    `\r\n--${multipartBoundary}--\r\n`,
);

const scenarios: Scenario[] = [
  {
    name: "parse JSON (~256 B)",
    method: "POST",
    path: "/bench/parse/json",
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({ title: "benchmark", payload: "x".repeat(220) }),
    ),
  },
  {
    name: "parse URL-encoded form",
    method: "POST",
    path: "/bench/parse/form",
    contentType: "application/x-www-form-urlencoded",
    body: Buffer.from("name=benchmark&tag=one&tag=two&enabled=true"),
  },
  {
    name: "parse binary (16 KiB)",
    method: "POST",
    path: "/bench/parse/binary",
    contentType: "application/octet-stream",
    body: Buffer.alloc(16 * 1_024, 0x78),
  },
  {
    name: "parse multipart (4 KiB file)",
    method: "POST",
    path: "/bench/parse/multipart",
    contentType: `multipart/form-data; boundary=${multipartBoundary}`,
    body: multipartBody,
  },
  {
    name: "serialize JSON response",
    method: "GET",
    path: "/bench/response/json",
  },
  { name: "send text response", method: "GET", path: "/bench/response/text" },
  {
    name: "send binary response (16 KiB)",
    method: "GET",
    path: "/bench/response/binary",
  },
  {
    name: "stream response (16 KiB)",
    method: "GET",
    path: "/bench/response/stream",
  },
  {
    name: "stream response (single 16 KiB chunk)",
    method: "GET",
    path: "/bench/response/stream-single",
  },
  {
    name: "deep nested route (8 segments, 3 params)",
    method: "GET",
    path: "/bench/v1/tenants/acme/projects/compiler/issues/42",
  },
];

const server = new HttpServer(BenchmarkResource);
const listeningServer = server.listen(0);
await once(listeningServer, "listening");
const address = listeningServer.address() as AddressInfo;
const agent = new Agent({ keepAlive: true, maxSockets: 1 });

try {
  console.log(
    `End-to-end HTTP benchmark | ${iterations} requests/sample | ${samples} samples | ${warmupIterations} warmup requests/scenario`,
  );
  console.log(`Node ${process.version} | http://127.0.0.1:${address.port}`);
  console.log("");

  for (const scenario of scenarios) {
    for (let index = 0; index < warmupIterations; index++) {
      await runRequest(address.port, agent, scenario);
    }

    const elapsedSamples: number[] = [];
    for (let sample = 0; sample < samples; sample++) {
      const start = performance.now();
      for (let index = 0; index < iterations; index++) {
        await runRequest(address.port, agent, scenario);
      }
      elapsedSamples.push(performance.now() - start);
    }

    const elapsedMs = median(elapsedSamples);
    const requestsPerSecond = (iterations / elapsedMs) * 1_000;
    console.log(
      `${scenario.name.padEnd(43)} ${requestsPerSecond.toFixed(0).padStart(8)} req/s  ${(elapsedMs / iterations).toFixed(3)} ms/req`,
    );
  }
} finally {
  agent.destroy();
  await server.close();
}

function runRequest(port: number, agent: Agent, scenario: Scenario) {
  return new Promise<void>((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: scenario.path,
        method: scenario.method,
        agent,
        headers: {
          ...(scenario.contentType
            ? { "content-type": scenario.contentType }
            : {}),
          ...(scenario.body
            ? { "content-length": scenario.body.byteLength }
            : {}),
        },
      },
      (response) => {
        let responseBytes = 0;
        response.on("data", (chunk: Buffer) => {
          responseBytes += chunk.byteLength;
        });
        response.on("error", reject);
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                `${scenario.name} returned HTTP ${response.statusCode}`,
              ),
            );
            return;
          }
          if (responseBytes === 0) {
            reject(new Error(`${scenario.name} returned an empty response`));
            return;
          }
          resolve();
        });
        response.resume();
      },
    );
    request.on("error", reject);
    request.end(scenario.body);
  });
}

function readPositiveInteger(name: string, fallback: number) {
  return readInteger(name, fallback, 1);
}

function readInteger(name: string, fallback: number, minimum: number) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}`,
    );
  }
  return parsed;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}
