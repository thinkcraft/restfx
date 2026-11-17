import { once } from "node:events";
import { request as httpRequest, Agent } from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
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
const { values: cliOptions } = parseArgs({
  options: { concurrency: { type: "string", short: "c" } },
  strict: true,
  allowPositionals: false,
});
const concurrency = readPositiveInteger(
  "BENCH_CONCURRENCY",
  1,
  cliOptions.concurrency,
);

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
  // noinspection JSUnusedLocalSymbols
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
const agent =
  concurrency === 1 ? new Agent({ keepAlive: true, maxSockets: 1 }) : undefined;

try {
  console.log(
    `End-to-end HTTP benchmark | ${iterations} requests/sample | ${samples} samples | ${warmupIterations} warmup requests/client/scenario | ${concurrency} client${concurrency === 1 ? "" : " workers"}`,
  );
  console.log(`Node ${process.version} | http://127.0.0.1:${address.port}`);
  console.log("");

  for (const scenario of scenarios) {
    if (concurrency === 1) {
      for (let index = 0; index < warmupIterations; index++) {
        await runRequest(address.port, agent!, scenario);
      }

      const elapsedSamples: number[] = [];
      for (let sample = 0; sample < samples; sample++) {
        const start = performance.now();
        for (let index = 0; index < iterations; index++) {
          await runRequest(address.port, agent!, scenario);
        }
        elapsedSamples.push(performance.now() - start);
      }

      const elapsedMs = median(elapsedSamples);
      const requestsPerSecond = (iterations / elapsedMs) * 1_000;
      console.log(
        `${scenario.name.padEnd(43)} ${requestsPerSecond.toFixed(0).padStart(8)} req/s  ${(elapsedMs / iterations).toFixed(3)} ms/req`,
      );
    } else {
      const result = await runConcurrentScenario(
        address.port,
        scenario,
        concurrency,
      );
      console.log(
        `${scenario.name.padEnd(43)} ${result.requestsPerSecond.toFixed(0).padStart(8)} req/s  p50 ${result.p50.toFixed(3)} ms  p95 ${result.p95.toFixed(3)} ms`,
      );
    }
  }
} finally {
  agent?.destroy();
  await server.close();
}

async function runConcurrentScenario(
  port: number,
  scenario: Scenario,
  workerCount: number,
) {
  const activeWorkers = Math.min(workerCount, iterations);
  const workers = Array.from({ length: activeWorkers }, (_, index) => {
    const workerIterations =
      Math.floor(iterations / activeWorkers) +
      (index < iterations % activeWorkers ? 1 : 0);
    return new Worker(new URL("./http.bench.worker.ts", import.meta.url), {
      workerData: {
        port,
        scenario,
        warmupIterations,
        iterations: workerIterations,
      },
    });
  });

  try {
    await Promise.all(
      workers.map((worker) => waitForWorkerMessage(worker, "ready")),
    );

    const elapsedSamples: number[] = [];
    const latencies: number[] = [];
    for (let sample = 0; sample < samples; sample++) {
      const completed = Promise.all(
        workers.map((worker) =>
          waitForWorkerMessage<{ type: "done"; latencies: number[] }>(
            worker,
            "done",
          ),
        ),
      );
      const start = performance.now();
      for (const worker of workers) worker.postMessage("run");
      const sampleLatencies = await completed;
      elapsedSamples.push(performance.now() - start);
      for (const result of sampleLatencies) latencies.push(...result.latencies);
    }

    const elapsedMs = median(elapsedSamples);
    return {
      requestsPerSecond: (iterations / elapsedMs) * 1_000,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    };
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}

function waitForWorkerMessage<T>(worker: Worker, expectedType: string) {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    const onMessage = (message: { type: string; error?: string }) => {
      if (message.type === "error") {
        cleanup();
        reject(new Error(message.error ?? "Benchmark worker failed"));
      } else if (message.type === expectedType) {
        cleanup();
        resolve(message as T);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number) => {
      cleanup();
      reject(new Error(`Benchmark worker exited unexpectedly (${code})`));
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
  });
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

function readPositiveInteger(
  name: string,
  fallback: number,
  override?: string,
) {
  return readInteger(name, fallback, 1, override);
}

function readInteger(
  name: string,
  fallback: number,
  minimum: number,
  override?: string,
) {
  const value = override ?? process.env[name];
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

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1]!;
}
