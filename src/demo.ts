import { startOrchestratorServer } from "./orchestrator";
import { startRunnerServer } from "./runner";

const runner = startRunnerServer(Number(Bun.env.DEMO_RUNNER_PORT ?? 42101));
const app = await startOrchestratorServer({
  port: Number(Bun.env.DEMO_PORT ?? 42100),
  runnerUrl: runner.url,
});

try {
  const response = await fetch(`${app.url}/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company: { name: "Acme", domain: "acme.example" },
      prospect: { firstName: "Maya", title: "VP of Sales" },
    }),
  });

  const started = (await response.json()) as { id: string };
  let workflow: Record<string, unknown> | undefined;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    await Bun.sleep(25);
    workflow = (await fetch(`${app.url}/workflows/${started.id}`).then((result) =>
      result.json(),
    )) as Record<string, unknown>;

    if (["approved", "rejected", "human_review", "failed"].includes(String(workflow.status))) {
      break;
    }
  }

  console.log(JSON.stringify(workflow, null, 2));
} finally {
  await app.stop();
  await runner.stop();
}
