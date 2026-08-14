import { afterEach, describe, expect, test } from "bun:test";
import type { OrchestratorServer } from "../src/orchestrator";
import { startOrchestratorServer } from "../src/orchestrator";
import type { RunnerServer } from "../src/runner";
import { startRunnerServer } from "../src/runner";

let runner: RunnerServer | undefined;
let app: OrchestratorServer | undefined;

afterEach(async () => {
  if (app) await app.stop();
  if (runner) await runner.stop();
  app = undefined;
  runner = undefined;
});

describe("outbound factory feedback loop", () => {
  test("routes a review rejection back to drafting and ultimately approves", async () => {
    runner = startRunnerServer(43101);
    app = await startOrchestratorServer({ port: 43100, runnerUrl: runner.url });

    const startResponse = await fetch(`${app.url}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: { name: "Acme", domain: "acme.example" },
        prospect: { firstName: "Maya", title: "VP of Sales" },
      }),
    });

    expect(startResponse.status).toBe(202);
    const started = (await startResponse.json()) as { id: string };

    let workflow = app.orchestrator.getWorkflow(started.id);
    for (
      let attempt = 0;
      attempt < 100 &&
      (workflow?.status === "running" || workflow?.status === "revising");
      attempt += 1
    ) {
      await Bun.sleep(20);
      workflow = app.orchestrator.getWorkflow(started.id);
    }

    expect(workflow?.status).toBe("approved");
    expect(workflow?.draftAttempt).toBe(2);
    expect(workflow?.draft?.revision).toBe(2);
    expect(workflow?.draft?.body).not.toContain("200 sales reps");
    expect(workflow?.verdicts.map(({ verdict }) => verdict.decision)).toEqual([
      "revise",
      "approve",
      "approve",
      "approve",
    ]);

    const eventTypes = app.orchestrator.events
      .eventsFor(started.id)
      .map(({ type }) => type);
    expect(eventTypes).toContain("feedback.routed");
    expect(eventTypes.at(-1)).toBe("workflow.approved");
  });

  test("rejects invalid workflow input before dispatch", async () => {
    runner = startRunnerServer(43201);
    app = await startOrchestratorServer({ port: 43200, runnerUrl: runner.url });

    const response = await fetch(`${app.url}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: { name: "Acme" } }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid workflow request");
  });
});
