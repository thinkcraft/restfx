import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { request, Agent, ServerResponse } from "node:http";
import { Socket, type AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { Session } from "node:inspector";
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

interface Scenario {
  readonly name: string;
  readonly path: string;
  readonly method: string;
  readonly contentType?: string;
  readonly body?: Buffer;
  readonly responseMode?: "string" | "buffer";
}

interface CpuProfile {
  readonly nodes: readonly {
    readonly id: number;
    readonly callFrame: {
      readonly functionName: string;
      readonly url: string;
      readonly lineNumber: number;
      readonly columnNumber: number;
    };
    readonly children?: readonly number[];
  }[];
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

interface ServerProfileMessage {
  readonly type: "profile";
  readonly profile: CpuProfile;
  readonly responseMetrics: ResponseMetrics;
  readonly eventLoopUtilization: {
    readonly active: number;
    readonly idle: number;
    readonly utilization: number;
  };
}

interface ResponseMetrics {
  readonly jsonStringifyCalls: number;
  readonly jsonStringifyTotalMs: number;
  readonly jsonStringifyMaxMs: number;
  readonly responseEndCalls: number;
  readonly responseEndTotalMs: number;
  readonly responseEndMaxMs: number;
  readonly completedResponses: number;
  readonly endToFinishTotalMs: number;
  readonly endToFinishMaxMs: number;
  readonly socketWriteCalls: number;
  readonly socketWriteTotalMs: number;
  readonly socketWriteMaxMs: number;
  readonly socketWriteBytes: number;
  readonly socketStringWriteCalls: number;
  readonly socketStringWriteBytes: number;
  readonly socketWritevCalls: number;
  readonly responseBufferConversions: number;
  readonly responseBufferConversionTotalMs: number;
  readonly responseBufferConversionMaxMs: number;
  readonly responseBufferConversionBytes: number;
}

@Model()
class ProfilePayload {
  @Field({ type: StringField, minLength: 3 })
  label!: string;

  @Field({ type: IntegerField, minimum: 0 })
  count!: number;

  @Field({ type: ArrayOf(StringField), minItems: 1 })
  tags!: string[];
}

@HttpResource("route")
class RouteResource {
  @HttpGet({ path: ":tenantId/projects/:projectId/issues/:issueId" })
  get(context: HttpContext) {
    const { tenantId, projectId, issueId } = context.req.params;
    return `${tenantId}/${projectId}/${issueId}`;
  }
}

@HttpResource("body")
class BodyResource {
  @HttpPost({ path: "json" })
  async parseJson(context: HttpContext) {
    const value = await context.req.parseBody<{ label: string }>();
    return value.label;
  }

  @HttpPost({ path: "model", body: ProfilePayload })
  async validateModel(context: HttpContext) {
    const value = await context.req.parseBody({ model: ProfilePayload });
    return value.label;
  }
}

const responsePayload = Array.from({ length: 128 }, (_, index) => ({
  id: index,
  label: `profile response item ${index}`,
  tags: ["routing", "serialization", "benchmark"],
}));

@HttpResource("response")
class ResponseResource {
  @HttpGet({ path: "json" })
  json() {
    return responsePayload;
  }
}

@HttpResource("profile")
class ProfileResource {
  // Class-decorated child resources are intentionally discovered from fields.
  readonly route = new RouteResource();
  readonly body = new BodyResource();
  readonly response = new ResponseResource();
}

const jsonBody = Buffer.from(JSON.stringify({ label: "profile request" }));
const modelBody = Buffer.from(
  JSON.stringify({
    label: "profile request",
    count: 42,
    tags: ["routing", "validation", "profile"],
  }),
);

const scenarios: readonly Scenario[] = [
  {
    name: "deep route matching + params",
    method: "GET",
    path: "/profile/route/acme/projects/compiler/issues/42",
  },
  {
    name: "JSON body parsing",
    method: "POST",
    path: "/profile/body/json",
    contentType: "application/json",
    body: jsonBody,
  },
  {
    name: "body model validation",
    method: "POST",
    path: "/profile/body/model",
    contentType: "application/json",
    body: modelBody,
  },
  {
    name: "JSON response (~12 KiB, Buffer)",
    method: "GET",
    path: "/profile/response/json",
    responseMode: "buffer",
  },
  {
    name: "JSON response (~12 KiB, string)",
    method: "GET",
    path: "/profile/response/json",
    responseMode: "string",
  },
];

if (process.argv.includes("--profile-server-child")) {
  await runProfileServer();
} else {
  await runProfiler();
}

async function runProfileServer() {
  if (!process.send) throw new Error("Profiler server requires IPC");

  const server = new HttpServer(ProfileResource);
  const listening = server.listen(0);
  await once(listening, "listening");
  const address = listening.address() as AddressInfo;
  const session = new Session();
  const responseMetrics = installResponseMetrics(
    process.env.PROFILE_RESPONSE_MODE === "buffer",
  );
  session.connect();
  await postInspector(session, "Profiler.enable");
  await postInspector(session, "Profiler.setSamplingInterval", {
    interval: 1_000,
  });

  let eventLoopStart: ReturnType<typeof performance.eventLoopUtilization>;
  process.send({ type: "ready", port: address.port });

  process.on("message", async (message: unknown) => {
    if (message === "start") {
      eventLoopStart = performance.eventLoopUtilization();
      responseMetrics.reset();
      responseMetrics.setEnabled(true);
      await postInspector(session, "Profiler.start");
      process.send?.({ type: "started" });
      return;
    }

    if (message === "stop") {
      try {
        responseMetrics.setEnabled(false);
        const { profile } = await postInspector<{ profile: CpuProfile }>(
          session,
          "Profiler.stop",
        );
        const eventLoopUtilization = performance.eventLoopUtilization(
          eventLoopStart!,
        );
        process.send?.({
          type: "profile",
          profile,
          responseMetrics: responseMetrics.snapshot(),
          eventLoopUtilization,
        } satisfies ServerProfileMessage);
        await server.close();
        session.disconnect();
        process.disconnect?.();
      } catch (error) {
        process.send?.({
          type: "error",
          error:
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
        });
      }
    }
  });
}

async function runProfiler() {
  const requests = readInteger("PROFILE_REQUESTS", 50_000, 1);
  const warmup = readInteger("PROFILE_WARMUP", 2_000, 0);
  const concurrency = readInteger("PROFILE_CONCURRENCY", 4, 1);
  const outputDirectory =
    process.env.PROFILE_OUTPUT_DIR ??
    join(
      tmpdir(),
      "framework-http-profiles",
      new Date().toISOString().replaceAll(":", "-"),
    );
  await mkdir(outputDirectory, { recursive: true });

  console.log(
    `HTTP CPU profiles | Node ${process.version} | ${requests} measured requests/scenario | ${warmup} warmup requests | concurrency ${concurrency}`,
  );
  console.log(`Profiles: ${outputDirectory}`);
  console.log("Server and load generator run in separate processes.\n");

  for (const scenario of scenarios) {
    const child = startProfileServer(scenario.responseMode ?? "string");
    let agent: Agent | undefined;
    try {
      const port = await waitForMessage<{ type: "ready"; port: number }>(
        child,
        "ready",
      ).then((message) => message.port);
      agent = new Agent({ keepAlive: true, maxSockets: concurrency });

      if (warmup > 0) {
        await runLoad(port, scenario, warmup, concurrency, agent);
      }
      await sendAndWait(child, "start", "started");
      const start = performance.now();
      await runLoad(port, scenario, requests, concurrency, agent);
      const elapsedMs = performance.now() - start;
      child.send("stop");
      const result = await waitForMessage<ServerProfileMessage>(
        child,
        "profile",
      );

      const profilePath = join(
        outputDirectory,
        `${slugify(scenario.name)}.cpuprofile`,
      );
      await writeFile(profilePath, JSON.stringify(result.profile));

      const requestsPerSecond = (requests / elapsedMs) * 1_000;
      console.log(`## ${scenario.name}`);
      console.log(
        `${requestsPerSecond.toFixed(0)} req/s | ${elapsedMs.toFixed(0)} ms | server event-loop utilization ${(result.eventLoopUtilization.utilization * 100).toFixed(1)}%`,
      );
      console.log(
        `CPU samples: ${result.profile.samples?.length ?? 0} at ~1 ms intervals`,
      );
      console.log("Top sampled CPU stacks (self time):");
      for (const entry of topSelfTime(result.profile).slice(0, 12)) {
        console.log(
          `  ${entry.percent.toFixed(1).padStart(5)}%  ${entry.name}  ${entry.location}`,
        );
      }
      console.log("Framework files present in sampled stacks (inclusive):");
      for (const entry of topFrameworkFiles(result.profile).slice(0, 8)) {
        console.log(
          `  ${entry.percent.toFixed(1).padStart(5)}%  ${entry.file}`,
        );
      }
      printResponseMetrics(result.responseMetrics);
      console.log(`Raw profile: ${profilePath}\n`);
    } finally {
      agent?.destroy();
      await stopChild(child);
    }
  }
}

function startProfileServer(responseMode: "string" | "buffer") {
  const scriptPath = fileURLToPath(import.meta.url);
  return fork(scriptPath, ["--profile-server-child"], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, PROFILE_RESPONSE_MODE: responseMode },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    serialization: "advanced",
  });
}

async function runLoad(
  port: number,
  scenario: Scenario,
  requestCount: number,
  concurrency: number,
  agent: Agent,
) {
  let nextRequest = 0;
  const runWorker = async () => {
    while (true) {
      const index = nextRequest++;
      if (index >= requestCount) return;
      await runRequest(port, scenario, agent);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, requestCount) }, runWorker),
  );
}

function runRequest(port: number, scenario: Scenario, agent: Agent) {
  return new Promise<void>((resolve, reject) => {
    const req = request(
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
      (res) => {
        let responseBytes = 0;
        res.on("data", (chunk: Buffer) => {
          responseBytes += chunk.byteLength;
        });
        res.once("error", reject);
        res.once("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(`${scenario.name} returned HTTP ${res.statusCode}`),
            );
          } else if (responseBytes === 0) {
            reject(new Error(`${scenario.name} returned an empty response`));
          } else {
            resolve();
          }
        });
      },
    );
    req.once("error", reject);
    req.end(scenario.body);
  });
}

function topSelfTime(profile: CpuProfile) {
  const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const weights = new Map<
    string,
    { name: string; location: string; time: number }
  >();
  let total = 0;

  for (let index = 0; index < samples.length; index++) {
    const node = nodeById.get(samples[index]!);
    if (!node) continue;
    const time = deltas[index] ?? 1_000;
    const name = node.callFrame.functionName || "(anonymous)";
    const url = node.callFrame.url;
    const location = url
      ? node.callFrame.lineNumber > 1
        ? `${basename(url)}:${node.callFrame.lineNumber + 1}`
        : basename(url)
      : "node:internal";
    const key = `${name}\0${location}`;
    const item = weights.get(key) ?? { name, location, time: 0 };
    item.time += time;
    weights.set(key, item);
    total += time;
  }

  return [...weights.values()]
    .map((entry) => ({
      ...entry,
      percent: total === 0 ? 0 : (entry.time / total) * 100,
    }))
    .sort((left, right) => right.time - left.time);
}

function topFrameworkFiles(profile: CpuProfile) {
  const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
  const parentById = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      parentById.set(child, node.id);
    }
  }

  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const weights = new Map<string, number>();
  let total = 0;
  for (let index = 0; index < samples.length; index++) {
    const time = deltas[index] ?? 1_000;
    total += time;
    const filesInStack = new Set<string>();
    let nodeId: number | undefined = samples[index];
    while (nodeId !== undefined) {
      const url = nodeById.get(nodeId)?.callFrame.url ?? "";
      if (
        url.includes("/packages/server/src/") ||
        url.includes("/packages/core/dist/")
      ) {
        filesInStack.add(basename(url));
      }
      nodeId = parentById.get(nodeId);
    }
    for (const file of filesInStack) {
      weights.set(file, (weights.get(file) ?? 0) + time);
    }
  }

  return [...weights]
    .map(([file, time]) => ({
      file,
      time,
      percent: total === 0 ? 0 : (time / total) * 100,
    }))
    .sort((left, right) => right.time - left.time);
}

function installResponseMetrics(bufferResponses: boolean) {
  let enabled = false;
  let jsonStringifyCalls = 0;
  let jsonStringifyTotalMs = 0;
  let jsonStringifyMaxMs = 0;
  let responseEndCalls = 0;
  let responseEndTotalMs = 0;
  let responseEndMaxMs = 0;
  let completedResponses = 0;
  let endToFinishTotalMs = 0;
  let endToFinishMaxMs = 0;
  let socketWriteCalls = 0;
  let socketWriteTotalMs = 0;
  let socketWriteMaxMs = 0;
  let socketWriteBytes = 0;
  let socketStringWriteCalls = 0;
  let socketStringWriteBytes = 0;
  let socketWritevCalls = 0;
  let responseBufferConversions = 0;
  let responseBufferConversionTotalMs = 0;
  let responseBufferConversionMaxMs = 0;
  let responseBufferConversionBytes = 0;
  const finishTracked = new WeakSet<ServerResponse>();

  const originalStringify = JSON.stringify;
  JSON.stringify = function (value, replacer, space) {
    if (!enabled) return originalStringify.call(this, value, replacer, space);
    const startedAt = performance.now();
    try {
      return originalStringify.call(this, value, replacer, space);
    } finally {
      const elapsedMs = performance.now() - startedAt;
      jsonStringifyCalls++;
      jsonStringifyTotalMs += elapsedMs;
      jsonStringifyMaxMs = Math.max(jsonStringifyMaxMs, elapsedMs);
    }
  };

  const responsePrototype = ServerResponse.prototype as any;
  const originalEnd = responsePrototype.end as (...args: any[]) => unknown;
  responsePrototype.end = function (this: ServerResponse, ...args: any[]) {
    if (bufferResponses && typeof args[0] === "string") {
      const conversionStartedAt = enabled ? performance.now() : 0;
      const body = Buffer.from(args[0], "utf8");
      args[0] = body;
      if (enabled) {
        const elapsedMs = performance.now() - conversionStartedAt;
        responseBufferConversions++;
        responseBufferConversionTotalMs += elapsedMs;
        responseBufferConversionMaxMs = Math.max(
          responseBufferConversionMaxMs,
          elapsedMs,
        );
        responseBufferConversionBytes += body.byteLength;
      }
    }

    if (!enabled) return originalEnd.apply(this, args);

    const endStartedAt = performance.now();
    if (!finishTracked.has(this)) {
      finishTracked.add(this);
      this.once("finish", () => {
        const elapsedMs = performance.now() - endStartedAt;
        completedResponses++;
        endToFinishTotalMs += elapsedMs;
        endToFinishMaxMs = Math.max(endToFinishMaxMs, elapsedMs);
      });
    }

    try {
      return originalEnd.apply(this, args);
    } finally {
      const elapsedMs = performance.now() - endStartedAt;
      responseEndCalls++;
      responseEndTotalMs += elapsedMs;
      responseEndMaxMs = Math.max(responseEndMaxMs, elapsedMs);
    }
  };

  const socketPrototype = Socket.prototype as any;
  const originalWriteGeneric = socketPrototype._writeGeneric as (
    ...args: any[]
  ) => unknown;
  socketPrototype._writeGeneric = function (this: Socket, ...args: any[]) {
    if (!enabled) return originalWriteGeneric.apply(this, args);

    const writev = args[0] === true;
    const { bytes, stringBytes } = measureWriteBytes(args[1], args[2]);
    const startedAt = performance.now();
    try {
      return originalWriteGeneric.apply(this, args);
    } finally {
      const elapsedMs = performance.now() - startedAt;
      socketWriteCalls++;
      socketWriteTotalMs += elapsedMs;
      socketWriteMaxMs = Math.max(socketWriteMaxMs, elapsedMs);
      socketWriteBytes += bytes;
      if (stringBytes > 0) {
        socketStringWriteCalls++;
        socketStringWriteBytes += stringBytes;
      }
      if (writev) socketWritevCalls++;
    }
  };

  return {
    setEnabled(value: boolean) {
      enabled = value;
    },
    reset() {
      jsonStringifyCalls = 0;
      jsonStringifyTotalMs = 0;
      jsonStringifyMaxMs = 0;
      responseEndCalls = 0;
      responseEndTotalMs = 0;
      responseEndMaxMs = 0;
      completedResponses = 0;
      endToFinishTotalMs = 0;
      endToFinishMaxMs = 0;
      socketWriteCalls = 0;
      socketWriteTotalMs = 0;
      socketWriteMaxMs = 0;
      socketWriteBytes = 0;
      socketStringWriteCalls = 0;
      socketStringWriteBytes = 0;
      socketWritevCalls = 0;
      responseBufferConversions = 0;
      responseBufferConversionTotalMs = 0;
      responseBufferConversionMaxMs = 0;
      responseBufferConversionBytes = 0;
    },
    snapshot(): ResponseMetrics {
      return {
        jsonStringifyCalls,
        jsonStringifyTotalMs,
        jsonStringifyMaxMs,
        responseEndCalls,
        responseEndTotalMs,
        responseEndMaxMs,
        completedResponses,
        endToFinishTotalMs,
        endToFinishMaxMs,
        socketWriteCalls,
        socketWriteTotalMs,
        socketWriteMaxMs,
        socketWriteBytes,
        socketStringWriteCalls,
        socketStringWriteBytes,
        socketWritevCalls,
        responseBufferConversions,
        responseBufferConversionTotalMs,
        responseBufferConversionMaxMs,
        responseBufferConversionBytes,
      };
    },
  };
}

function printResponseMetrics(metrics: ResponseMetrics) {
  console.log("Targeted response timings:");
  if (metrics.jsonStringifyCalls > 0) {
    console.log(
      `  JSON.stringify: ${metrics.jsonStringifyCalls} calls, avg ${(metrics.jsonStringifyTotalMs / metrics.jsonStringifyCalls).toFixed(4)} ms, total ${metrics.jsonStringifyTotalMs.toFixed(1)} ms, max ${metrics.jsonStringifyMaxMs.toFixed(3)} ms`,
    );
  } else {
    console.log("  JSON.stringify: not used in this scenario");
  }
  console.log(
    `  ServerResponse.end(): ${metrics.responseEndCalls} calls, avg ${averageMs(metrics.responseEndTotalMs, metrics.responseEndCalls).toFixed(4)} ms, total ${metrics.responseEndTotalMs.toFixed(1)} ms, max ${metrics.responseEndMaxMs.toFixed(3)} ms`,
  );
  console.log(
    `  end() → finish: ${metrics.completedResponses} responses, avg ${averageMs(metrics.endToFinishTotalMs, metrics.completedResponses).toFixed(3)} ms, max ${metrics.endToFinishMaxMs.toFixed(3)} ms (wall time; includes output flush/scheduling)`,
  );
  console.log(
    `  Socket._writeGeneric(): ${metrics.socketWriteCalls} calls, avg ${averageMs(metrics.socketWriteTotalMs, metrics.socketWriteCalls).toFixed(4)} ms, total ${metrics.socketWriteTotalMs.toFixed(1)} ms, max ${metrics.socketWriteMaxMs.toFixed(3)} ms; ${formatBytes(metrics.socketWriteBytes)} dispatched; ${metrics.socketStringWriteCalls} string writes (${formatBytes(metrics.socketStringWriteBytes)}); ${metrics.socketWritevCalls} writev calls`,
  );
  if (metrics.responseBufferConversions > 0) {
    console.log(
      `  Buffer.from(string): ${metrics.responseBufferConversions} conversions, avg ${averageMs(metrics.responseBufferConversionTotalMs, metrics.responseBufferConversions).toFixed(4)} ms, total ${metrics.responseBufferConversionTotalMs.toFixed(1)} ms, max ${metrics.responseBufferConversionMaxMs.toFixed(3)} ms; ${formatBytes(metrics.responseBufferConversionBytes)} converted`,
    );
  }
}

function averageMs(totalMs: number, count: number) {
  return count === 0 ? 0 : totalMs / count;
}

function measureWriteBytes(data: unknown, encoding?: BufferEncoding) {
  if (typeof data === "string") {
    const bytes = Buffer.byteLength(data, encoding);
    return { bytes, stringBytes: bytes };
  }
  if (Buffer.isBuffer(data) || ArrayBuffer.isView(data)) {
    return { bytes: data.byteLength, stringBytes: 0 };
  }
  if (Array.isArray(data)) {
    return data.reduce(
      (total, item: unknown) => {
        const chunk =
          item !== null && typeof item === "object" && "chunk" in item
            ? item.chunk
            : item;
        const size = measureWriteBytes(chunk);
        return {
          bytes: total.bytes + size.bytes,
          stringBytes: total.stringBytes + size.stringBytes,
        };
      },
      { bytes: 0, stringBytes: 0 },
    );
  }
  return { bytes: 0, stringBytes: 0 };
}

function formatBytes(value: number) {
  return value >= 1_048_576
    ? `${(value / 1_048_576).toFixed(1)} MiB`
    : `${(value / 1_024).toFixed(1)} KiB`;
}

function postInspector<T = unknown>(
  session: Session,
  method: string,
  params?: Record<string, unknown>,
) {
  return new Promise<T>((resolve, reject) => {
    session.post(method as never, params as never, (error, result) => {
      if (error) reject(error);
      else resolve(result as T);
    });
  });
}

function sendAndWait(child: ChildProcess, message: string, expected: string) {
  const response = waitForMessage<{ type: string }>(child, expected);
  child.send(message);
  return response;
}

function waitForMessage<T extends { type: string }>(
  child: ChildProcess,
  expected: string,
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
      const typed = message as { type: string; error?: string };
      if (typed.type === "error") {
        cleanup();
        reject(new Error(typed.error ?? "Profiler server failed"));
      } else if (typed.type === expected) {
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
      reject(new Error(`Profiler server exited unexpectedly (${code})`));
    };
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await once(child, "exit").catch(() => undefined);
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
