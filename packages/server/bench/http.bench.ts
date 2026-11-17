import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest, Agent, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import express from "express";
import multer from "multer";
import {
  ArrayOf,
  Field,
  HttpContext,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpServer,
  IntegerField,
  Model,
  StringField,
} from "../src/index.js";

const iterations = readPositiveInteger("BENCH_ITERATIONS", 1_000);
const samples = readPositiveInteger("BENCH_SAMPLES", 3);
const warmupIterations = readInteger("BENCH_WARMUP", 100, 0);
const { values: cliOptions } = parseArgs({
  options: {
    concurrency: { type: "string", short: "c" },
    server: { type: "string", default: "framework" },
  },
  strict: true,
  allowPositionals: false,
});
const backend = cliOptions.server ?? "framework";
if (backend !== "framework" && backend !== "express") {
  throw new Error("--server must be either 'framework' or 'express'");
}
const concurrency = readPositiveInteger(
  "BENCH_CONCURRENCY",
  4,
  cliOptions.concurrency,
);

@Model()
class ValidatedRequest {
  @Field({ type: StringField, minLength: 3 })
  label!: string;

  @Field({ type: IntegerField, minimum: 0 })
  count!: number;

  @Field({ type: ArrayOf(StringField), minItems: 1 })
  tags!: string[];
}

class ParsingResource {
  @HttpPost({ path: "json" })
  async json(context: HttpContext) {
    return context.req.parseBody<Record<string, unknown>>();
  }

  @HttpPost({ path: "model", body: ValidatedRequest })
  async model(context: HttpContext) {
    const value = await context.req.parseBody({ model: ValidatedRequest });
    return value.label;
  }

  @HttpPost({ path: "form" })
  async form(context: HttpContext) {
    return context.req.parseBody<Record<string, unknown>>();
  }

  @HttpPost({ path: "binary" })
  async binary(context: HttpContext) {
    const body = await context.req.parseBody<Buffer>();
    return { bytes: body.byteLength };
  }

  @HttpPost({ path: "multipart" })
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

  @HttpGet({ path: "json" })
  json() {
    return {
      ok: true,
      values: Array.from({ length: 64 }, (_, index) => index),
    };
  }

  @HttpGet({ path: "text" })
  text() {
    return "benchmark response ".repeat(256);
  }

  @HttpGet({ path: "binary" })
  binary() {
    return this.binaryBody;
  }

  @HttpGet({ path: "stream" })
  async *stream() {
    const chunk = "s".repeat(1_024);
    for (let index = 0; index < 16; index++) yield chunk;
  }

  @HttpGet({ path: "stream-single" })
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

interface BenchmarkServer {
  listen(port: number): Server;
  close(): Promise<void>;
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
    name: "parse + validate request model",
    method: "POST",
    path: "/bench/parse/model",
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({
        label: "benchmark payload",
        count: 42,
        tags: ["routing", "validation", "benchmark"],
      }),
    ),
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

if (process.env.BENCH_SERVER_CHILD === "1") {
  await runServerChild();
} else {
  await runBenchmark();
}

async function runBenchmark() {
  const server = fork(fileURLToPath(import.meta.url), ["--server", backend], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, BENCH_SERVER_CHILD: "1" },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    serialization: "advanced",
  });
  const agent =
    concurrency === 1
      ? new Agent({ keepAlive: true, maxSockets: 1 })
      : undefined;

  try {
    const { port } = await waitForChildMessage<{ type: "ready"; port: number }>(
      server,
      "ready",
    );
    console.log(
      `End-to-end HTTP benchmark (${backend}) | ${iterations} requests/sample | ${samples} samples | ${warmupIterations} warmup requests/client/scenario | ${concurrency} client${concurrency === 1 ? "" : " workers"}`,
    );
    console.log(`Node ${process.version} | http://127.0.0.1:${port}`);
    console.log(
      "Server runs in a separate process; clients use this process.\n",
    );

    for (const scenario of scenarios) {
      if (concurrency === 1) {
        for (let index = 0; index < warmupIterations; index++) {
          await runRequest(port, agent!, scenario);
        }

        const elapsedSamples: number[] = [];
        for (let sample = 0; sample < samples; sample++) {
          const start = performance.now();
          for (let index = 0; index < iterations; index++) {
            await runRequest(port, agent!, scenario);
          }
          elapsedSamples.push(performance.now() - start);
        }

        const elapsedMs = median(elapsedSamples);
        const requestsPerSecond = (iterations / elapsedMs) * 1_000;
        console.log(
          `${scenario.name.padEnd(43)} ${requestsPerSecond.toFixed(0).padStart(8)} req/s  ${(elapsedMs / iterations).toFixed(3)} ms/req`,
        );
      } else {
        const result = await runConcurrentScenario(port, scenario, concurrency);
        console.log(
          `${scenario.name.padEnd(43)} ${result.requestsPerSecond.toFixed(0).padStart(8)} req/s  p50 ${result.p50.toFixed(3)} ms  p95 ${result.p95.toFixed(3)} ms  p99 ${result.p99.toFixed(3)} ms`,
        );
      }
    }
  } finally {
    agent?.destroy();
    await stopServerChild(server);
  }
}

async function runServerChild() {
  if (!process.send) throw new Error("Benchmark server requires IPC");
  const server =
    backend === "framework"
      ? new HttpServer(BenchmarkResource)
      : createExpressServer();
  const listeningServer = server.listen(0);
  await once(listeningServer, "listening");
  const address = listeningServer.address() as AddressInfo;
  process.send({ type: "ready", port: address.port });

  process.on("message", (message: unknown) => {
    if (message !== "stop") return;
    void server.close().then(() => {
      process.send?.({ type: "stopped" }, () => process.disconnect?.());
    });
  });
}

function createExpressServer(): BenchmarkServer {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() });
  const binaryBody = Buffer.alloc(16 * 1_024, 0x62);

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(express.raw({ type: "application/octet-stream", limit: "1mb" }));

  app.post("/bench/parse/json", (request, response) => {
    response.json(request.body);
  });
  app.post("/bench/parse/model", (request, response) => {
    const { label, count, tags } = request.body as {
      label?: unknown;
      count?: unknown;
      tags?: unknown;
    };
    if (
      typeof label !== "string" ||
      label.length < 3 ||
      !Number.isInteger(count) ||
      (count as number) < 0 ||
      !Array.isArray(tags) ||
      tags.length < 1 ||
      !tags.every((tag: unknown) => typeof tag === "string")
    ) {
      response.status(422).json({ error: "Invalid request model" });
      return;
    }
    response.type("text/plain").send(label);
  });
  app.post("/bench/parse/form", (request, response) => {
    response.json(request.body);
  });
  app.post("/bench/parse/binary", (request, response) => {
    response.json({ bytes: (request.body as Buffer).byteLength });
  });
  app.post(
    "/bench/parse/multipart",
    upload.single("upload"),
    (request, response) => {
      if (!request.file) {
        response.status(400).json({ error: "Missing upload" });
        return;
      }
      response.json({
        note: request.body.note,
        filename: request.file.originalname,
        bytes: request.file.buffer.byteLength,
      });
    },
  );

  app.get("/bench/response/json", (_request, response) => {
    response.json({
      ok: true,
      values: Array.from({ length: 64 }, (_, index) => index),
    });
  });
  app.get("/bench/response/text", (_request, response) => {
    response.type("text/plain").send("benchmark response ".repeat(256));
  });
  app.get("/bench/response/binary", (_request, response) => {
    response.send(binaryBody);
  });
  app.get("/bench/response/stream", (_request, response) => {
    const chunk = "s".repeat(1_024);
    for (let index = 0; index < 16; index++) response.write(chunk);
    response.end();
  });
  app.get("/bench/response/stream-single", (_request, response) => {
    response.end("s".repeat(16 * 1_024));
  });
  app.get(
    "/bench/v1/tenants/:tenantId/projects/:projectId/issues/:issueId",
    (request, response) => {
      response.json({
        tenantId: request.params.tenantId,
        projectId: request.params.projectId,
        issueId: request.params.issueId,
      });
    },
  );

  let listeningServer: Server | undefined;
  return {
    listen(port) {
      listeningServer = app.listen(port);
      return listeningServer;
    },
    close() {
      if (!listeningServer?.listening) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        listeningServer!.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
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
      p99: percentile(latencies, 0.99),
    };
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}

function waitForChildMessage<T extends { type: string }>(
  child: ChildProcess,
  expectedType: string,
) {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !("type" in message))
        return;
      const typedMessage = message as { type: string; error?: string };
      if (typedMessage.type === "error") {
        cleanup();
        reject(new Error(typedMessage.error ?? "Benchmark server failed"));
      } else if (typedMessage.type === expectedType) {
        cleanup();
        resolve(message as T);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Benchmark server exited unexpectedly (${code})`));
    };
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function stopServerChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (!child.connected) {
    await once(child, "exit");
    return;
  }

  const stopped = waitForChildMessage(child, "stopped");
  child.send("stop");
  await stopped;
  if (child.exitCode === null && child.signalCode === null) {
    await once(child, "exit");
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
