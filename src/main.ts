import { startOrchestratorServer } from "./orchestrator";
import { startRunnerServer } from "./runner";

const runnerPort = Number(Bun.env.RUNNER_PORT ?? 4101);
const orchestratorPort = Number(Bun.env.PORT ?? 4100);

const runner = startRunnerServer(runnerPort);
const orchestrator = await startOrchestratorServer({
  port: orchestratorPort,
  runnerUrl: runner.url,
});

console.log(`Runner WebSocket: ${runner.url}`);
console.log(`Orchestrator API: ${orchestrator.url}`);
console.log("Start a workflow with POST /workflows");

async function shutdown() {
  await orchestrator.stop();
  await runner.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
