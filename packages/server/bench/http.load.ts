import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { request, Agent } from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
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

const durationSeconds = readInteger("LOAD_DURATION_SECONDS", 60, 1);
const warmupSeconds = readInteger("LOAD_WARMUP_SECONDS", 10, 0);
const concurrency = readInteger("LOAD_CONCURRENCY", 16, 1);
const sampleSeconds = readInteger("LOAD_SAMPLE_SECONDS", 5, 1);
const forceGc = readBoolean("LOAD_FORCE_GC", true);
const maxHeapGrowthMb = readOptionalNumber("LOAD_MAX_HEAP_GROWTH_MB");

const latencyBoundsMs = [
  0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1_000, 2_000, 5_000,
];

@Model()
class LoadRequest {
  @Field({ type: StringField, minLength: 3 })
  label!: string;

  @Field({ type: IntegerField, minimum: 0 })
  sequence!: number;
}

@HttpResource("load")
class LoadResource {
  @HttpGet({ path: "json" })
  json() {
    return { ok: true, values: responseValues };
  }

  @HttpPost({ path: "parse", body: LoadRequest })
  async parse(context: HttpContext) {
    const body = await context.req.parseBody({ model: LoadRequest });
    return { accepted: body.label, sequence: body.sequence };
  }

  @HttpGet({ path: "stream" })
  async *stream() {
    for (let index = 0; index < 8; index++) yield streamChunk;
  }
}

const responseValues = Array.from({ length: 64 }, (_, index) => ({
  id: index,
  label: `load response item ${index}`,
}));
const streamChunk = "s".repeat(1_024);
const loadBody = Buffer.from(
  JSON.stringify({ label: "load-test", sequence: 42 }),
);
const scenarios = [
  { method: "GET", path: "/load/json" },
  {
    method: "POST",
    path: "/load/parse",
    contentType: "application/json",
    body: loadBody,
  },
  { method: "GET", path: "/load/stream" },
] as const;

if (process.env.LOAD_SERVER_CHILD === "1") {
  await runServerChild();
} else {
  await runLoadTest();
}

interface MemoryUsage {
  readonly rss: number;
  readonly heapUsed: number;
  readonly external: number;
  readonly arrayBuffers: number;
}

interface ServerSample {
  readonly type: "sample";
  readonly beforeGc: MemoryUsage;
  readonly afterGc: MemoryUsage;
  readonly eventLoopUtilization: number;
}

interface Histogram {
  readonly bins: number[];
  count: number;
}

interface LoadStats {
  requests: number;
  errors: number;
  readonly histogram: Histogram;
  windowRequests: number;
  windowErrors: number;
  readonly windowHistogram: Histogram;
}

async function runLoadTest() {
  const server = fork(fileURLToPath(import.meta.url), [], {
    execArgv: ["--import", "tsx", "--expose-gc"],
    env: { ...process.env, LOAD_SERVER_CHILD: "1" },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    serialization: "advanced",
  });
  const agent = new Agent({ keepAlive: true, maxSockets: concurrency });

  try {
    const { port } = await waitForChildMessage<{ type: "ready"; port: number }>(
      server,
      "ready",
    );
    console.log(
      `HTTP load/soak test | Node ${process.version} | ${durationSeconds}s measured + ${warmupSeconds}s warmup | ${concurrency} clients`,
    );
    console.log(
      `Server: http://127.0.0.1:${port} | workload: JSON response, validated JSON request, streamed response | forced GC samples: ${forceGc ? "on" : "off"}`,
    );
    console.log("Server and load generator run in separate processes.\n");

    if (warmupSeconds > 0) {
      console.log(`Warming up for ${warmupSeconds}s...`);
      await runFor(port, agent, warmupSeconds * 1_000);
    }

    const baseline = await requestMemorySample(server, forceGc);
    printMemory("Baseline after warmup", baseline.afterGc);
    console.log(
      "\nElapsed   req/s   p50 ms   p95 ms   p99 ms   errors  heap pre/post   RSS   external   buffers",
    );

    const stats = createLoadStats();
    const startedAt = performance.now();
    const deadline = startedAt + durationSeconds * 1_000;
    const workers = Array.from({ length: concurrency }, (_, index) =>
      loadWorker(port, agent, stats, index, deadline),
    );
    let previousSampleAt = startedAt;

    while (performance.now() < deadline) {
      await delay(
        Math.min(sampleSeconds * 1_000, deadline - performance.now()),
      );
      const now = performance.now();
      const sample = await requestMemorySample(server, forceGc);
      const elapsedSeconds = (now - previousSampleAt) / 1_000;
      printWindow((now - startedAt) / 1_000, elapsedSeconds, stats, sample);
      resetWindow(stats);
      previousSampleAt = now;
    }

    await Promise.all(workers);
    const finalSample = await requestMemorySample(server, forceGc);
    const elapsedSeconds = (performance.now() - startedAt) / 1_000;
    console.log(
      "\nFinal (including requests still in flight at the deadline):",
    );
    printTotals(elapsedSeconds, stats, finalSample.afterGc);

    const heapGrowthMb =
      (finalSample.afterGc.heapUsed - baseline.afterGc.heapUsed) / 1_048_576;
    console.log(
      `Post-GC heap change from baseline: ${formatSigned(heapGrowthMb)} MiB; event-loop utilization at final sample: ${(finalSample.eventLoopUtilization * 100).toFixed(1)}%`,
    );
    if (maxHeapGrowthMb !== undefined && heapGrowthMb > maxHeapGrowthMb) {
      throw new Error(
        `Post-GC heap grew by ${heapGrowthMb.toFixed(1)} MiB, above LOAD_MAX_HEAP_GROWTH_MB=${maxHeapGrowthMb}`,
      );
    }
    if (stats.errors > 0) {
      throw new Error(`Load test observed ${stats.errors} failed requests`);
    }
  } finally {
    agent.destroy();
    await stopServerChild(server);
  }
}

async function runFor(port: number, agent: Agent, durationMs: number) {
  const warmupStats = createLoadStats();
  const deadline = performance.now() + durationMs;
  await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      loadWorker(port, agent, warmupStats, index, deadline),
    ),
  );
  console.log(
    `Warmup: ${warmupStats.requests} requests (${(warmupStats.requests / (durationMs / 1_000)).toFixed(0)} req/s), ${warmupStats.errors} errors`,
  );
  if (warmupStats.errors > 0) {
    throw new Error(`Warmup observed ${warmupStats.errors} failed requests`);
  }
}

async function loadWorker(
  port: number,
  agent: Agent,
  stats: LoadStats,
  workerIndex: number,
  deadline = Number.POSITIVE_INFINITY,
) {
  let scenarioIndex = workerIndex;
  while (performance.now() < deadline) {
    const scenario = scenarios[scenarioIndex % scenarios.length]!;
    scenarioIndex++;
    const startedAt = performance.now();
    let failed = false;
    try {
      await runRequest(port, agent, scenario);
    } catch (error) {
      failed = true;
      if (stats.errors < 5) {
        console.error(
          `Request failure: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const latencyMs = performance.now() - startedAt;
    record(stats, latencyMs, failed);
  }
}

function runRequest(
  port: number,
  agent: Agent,
  scenario: (typeof scenarios)[number],
) {
  return new Promise<void>((resolve, reject) => {
    const requestMessage = request(
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
        response.once("error", reject);
        response.once("end", () => {
          if (response.statusCode !== 200) {
            reject(
              new Error(`HTTP ${response.statusCode} for ${scenario.path}`),
            );
          } else if (responseBytes === 0) {
            reject(new Error(`Empty response for ${scenario.path}`));
          } else {
            resolve();
          }
        });
      },
    );
    requestMessage.setTimeout(30_000, () =>
      requestMessage.destroy(new Error("Request timed out after 30 seconds")),
    );
    requestMessage.once("error", reject);
    requestMessage.end(scenario.body);
  });
}

async function runServerChild() {
  if (!process.send) throw new Error("Load-test server requires IPC");
  const server = new HttpServer(LoadResource);
  const listening = server.listen(0);
  await once(listening, "listening");
  const address = listening.address() as AddressInfo;
  let previousEventLoopUtilization = performance.eventLoopUtilization();
  process.send({ type: "ready", port: address.port });

  process.on("message", async (message: unknown) => {
    if (
      message !== null &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "sample"
    ) {
      const beforeGc = process.memoryUsage();
      if ("collectGc" in message && message.collectGc === true) {
        const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
        gc?.();
      }
      const afterGc = process.memoryUsage();
      const utilization = performance.eventLoopUtilization(
        previousEventLoopUtilization,
      );
      previousEventLoopUtilization = performance.eventLoopUtilization();
      process.send?.({
        type: "sample",
        beforeGc,
        afterGc,
        eventLoopUtilization: utilization.utilization,
      } satisfies ServerSample);
      return;
    }
    if (message === "stop") {
      await server.close();
      process.send?.({ type: "stopped" }, () => process.disconnect?.());
    }
  });
}

function createLoadStats(): LoadStats {
  return {
    requests: 0,
    errors: 0,
    histogram: { bins: Array(latencyBoundsMs.length + 1).fill(0), count: 0 },
    windowRequests: 0,
    windowErrors: 0,
    windowHistogram: {
      bins: Array(latencyBoundsMs.length + 1).fill(0),
      count: 0,
    },
  };
}

function record(stats: LoadStats, latencyMs: number, failed: boolean) {
  stats.requests++;
  stats.windowRequests++;
  if (failed) {
    stats.errors++;
    stats.windowErrors++;
  }
  recordLatency(stats.histogram, latencyMs);
  recordLatency(stats.windowHistogram, latencyMs);
}

function recordLatency(histogram: Histogram, latencyMs: number) {
  const index = latencyBoundsMs.findIndex((bound) => latencyMs <= bound);
  histogram.bins[index === -1 ? latencyBoundsMs.length : index]!++;
  histogram.count++;
}

function resetWindow(stats: LoadStats) {
  stats.windowRequests = 0;
  stats.windowErrors = 0;
  stats.windowHistogram.count = 0;
  stats.windowHistogram.bins.fill(0);
}

function printWindow(
  elapsedSeconds: number,
  intervalSeconds: number,
  stats: LoadStats,
  sample: ServerSample,
) {
  console.log(
    `${elapsedSeconds.toFixed(0).padStart(7)}s ${(
      stats.windowRequests / intervalSeconds
    )
      .toFixed(0)
      .padStart(
        7,
      )} ${formatLatency(stats.windowHistogram, 0.5).padStart(8)} ${formatLatency(
      stats.windowHistogram,
      0.95,
    ).padStart(
      8,
    )} ${formatLatency(stats.windowHistogram, 0.99).padStart(8)} ${stats.windowErrors
      .toString()
      .padStart(
        7,
      )} ${`${formatMiB(sample.beforeGc.heapUsed)}/${formatMiB(sample.afterGc.heapUsed)}`.padStart(14)} ${formatMiB(sample.afterGc.rss).padStart(7)} ${formatMiB(sample.afterGc.external).padStart(9)} ${formatMiB(sample.afterGc.arrayBuffers).padStart(8)}  ELU ${(sample.eventLoopUtilization * 100).toFixed(0)}%`,
  );
}

function printTotals(
  elapsedSeconds: number,
  stats: LoadStats,
  memory: MemoryUsage,
) {
  console.log(
    `${stats.requests} requests in ${elapsedSeconds.toFixed(1)}s (${(stats.requests / elapsedSeconds).toFixed(0)} req/s), ${stats.errors} errors; p50 ${formatLatency(stats.histogram, 0.5)} ms, p95 ${formatLatency(stats.histogram, 0.95)} ms, p99 ${formatLatency(stats.histogram, 0.99)} ms`,
  );
  printMemory("Final post-GC", memory);
}

function printMemory(label: string, memory: MemoryUsage) {
  console.log(
    `${label}: heap ${formatMiB(memory.heapUsed)} MiB | RSS ${formatMiB(memory.rss)} MiB | external ${formatMiB(memory.external)} MiB | ArrayBuffers ${formatMiB(memory.arrayBuffers)} MiB`,
  );
}

function formatLatency(histogram: Histogram, fraction: number) {
  if (histogram.count === 0) return "n/a";
  const target = Math.ceil(histogram.count * fraction);
  let accumulated = 0;
  for (let index = 0; index < histogram.bins.length; index++) {
    accumulated += histogram.bins[index]!;
    if (accumulated >= target) {
      return index < latencyBoundsMs.length
        ? latencyBoundsMs[index]!.toFixed(2)
        : `>${latencyBoundsMs.at(-1)}`;
    }
  }
  return "n/a";
}

async function requestMemorySample(child: ChildProcess, collectGc: boolean) {
  const pending = waitForChildMessage<ServerSample>(child, "sample");
  child.send({ type: "sample", collectGc });
  return pending;
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
        reject(new Error(typedMessage.error ?? "Load-test server failed"));
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
      reject(new Error(`Load-test server exited unexpectedly (${code})`));
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
  if (child.exitCode === null && child.signalCode === null)
    await once(child, "exit");
}

function readInteger(name: string, fallback: number, minimum: number) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}`,
    );
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  throw new Error(`${name} must be 1, 0, true, or false`);
}

function readOptionalNumber(name: string) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function formatMiB(bytes: number) {
  return (bytes / 1_048_576).toFixed(1);
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
