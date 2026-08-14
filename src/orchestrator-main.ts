import { readSecret } from "./auth";
import { startOrchestratorServer } from "./orchestrator";
import type { RunnerEndpointMap } from "./runner-role";

const runnerUrls: RunnerEndpointMap = {
  research: requiredEnv("RUNNER_RESEARCH_URL"),
  drafting: requiredEnv("RUNNER_DRAFTING_URL"),
  critic: requiredEnv("RUNNER_CRITIC_URL"),
  send: requiredEnv("RUNNER_SEND_URL"),
};
const runnerAuthToken = await readSecret(
  Bun.env.RUNNER_AUTH_TOKEN,
  Bun.env.RUNNER_AUTH_TOKEN_FILE,
);
const apiToken = await readSecret(
  Bun.env.ORCHESTRATOR_API_TOKEN,
  Bun.env.ORCHESTRATOR_API_TOKEN_FILE,
);
const app = await startOrchestratorServer({
  hostname: Bun.env.HOST ?? "0.0.0.0",
  port: Number(Bun.env.PORT ?? 8000),
  runnerUrls,
  runnerAuthToken,
  apiToken,
  maxDraftAttempts: Number(Bun.env.MAX_DRAFT_ATTEMPTS ?? 3),
});

console.log(`Orchestrator API: ${app.url}`);
console.log(`Runner states: ${JSON.stringify(app.orchestrator.runnerStates())}`);

async function shutdown() {
  await app.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
