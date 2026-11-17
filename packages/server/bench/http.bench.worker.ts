import { request, Agent } from "node:http";
import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";

interface WorkerScenario {
  name: string;
  method: string;
  path: string;
  contentType?: string;
  body?: Uint8Array;
}

interface WorkerInput {
  port: number;
  scenario: WorkerScenario;
  warmupIterations: number;
  iterations: number;
}

if (parentPort === null) throw new Error("Expected a worker thread");

const port = parentPort;
const input = workerData as WorkerInput;
const agent = new Agent({ keepAlive: true, maxSockets: 1 });

try {
  for (let index = 0; index < input.warmupIterations; index++) {
    await runRequest();
  }
  port.postMessage({ type: "ready" });

  port.on("message", (message: unknown) => {
    if (message !== "run") return;
    void runSample()
      .then((latencies) => port.postMessage({ type: "done", latencies }))
      .catch((error: unknown) => {
        port.postMessage({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
} catch (error) {
  port.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
}

async function runSample() {
  const latencies: number[] = [];
  for (let index = 0; index < input.iterations; index++) {
    const start = performance.now();
    await runRequest();
    latencies.push(performance.now() - start);
  }
  return latencies;
}

function runRequest() {
  return new Promise<void>((resolve, reject) => {
    const body = input.scenario.body;
    const requestMessage = request(
      {
        host: "127.0.0.1",
        port: input.port,
        path: input.scenario.path,
        method: input.scenario.method,
        agent,
        headers: {
          ...(input.scenario.contentType
            ? { "content-type": input.scenario.contentType }
            : {}),
          ...(body ? { "content-length": body.byteLength } : {}),
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
                `${input.scenario.name} returned HTTP ${response.statusCode}`,
              ),
            );
          } else if (responseBytes === 0) {
            reject(
              new Error(`${input.scenario.name} returned an empty response`),
            );
          } else {
            resolve();
          }
        });
        response.resume();
      },
    );
    requestMessage.on("error", reject);
    requestMessage.end(body);
  });
}
