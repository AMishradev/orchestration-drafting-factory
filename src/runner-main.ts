import { readSecret } from "./auth";
import { RunnerRoleSchema } from "./runner-role";
import { startRunnerServer } from "./runner";

const role = RunnerRoleSchema.parse(Bun.env.RUNNER_ROLE ?? "all");
const port = Number(Bun.env.PORT ?? 8000);
const authToken = await readSecret(
  Bun.env.RUNNER_AUTH_TOKEN,
  Bun.env.RUNNER_AUTH_TOKEN_FILE,
);
const runner = startRunnerServer(port, {
  role,
  hostname: Bun.env.HOST ?? "0.0.0.0",
  authToken,
});

console.log(`Runner role: ${runner.role}`);
console.log(`Runner WebSocket: ${runner.url}`);
console.log(`Research engine: ${runner.researchEngine}`);
console.log(`Drafting engine: ${runner.draftingEngine}`);
console.log(`Critic engine: ${runner.criticEngine}`);
console.log(`Send engine: ${runner.sendEngine}`);

async function shutdown() {
  await runner.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
