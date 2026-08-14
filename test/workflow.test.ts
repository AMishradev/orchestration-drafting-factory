import { afterEach, describe, expect, test } from "bun:test";
import type { OrchestratorServer } from "../src/orchestrator";
import { startOrchestratorServer } from "../src/orchestrator";
import type { RunnerServer } from "../src/runner";
import { startRunnerServer } from "../src/runner";
import type { SendAgent } from "../src/send-agent";

let runner: RunnerServer | undefined;
let app: OrchestratorServer | undefined;

afterEach(async () => {
  if (app) await app.stop();
  if (runner) await runner.stop();
  app = undefined;
  runner = undefined;
});

describe("outbound factory feedback loop", () => {
  test("routes feedback to drafting and sends the approved outbound", async () => {
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

    expect(workflow?.status).toBe("sent");
    expect(workflow?.draftAttempt).toBe(3);
    expect(workflow?.draft?.revision).toBe(3);
    expect(workflow?.draft?.body).not.toContain("200 sales reps");
    expect(workflow?.draft?.body.toLowerCase()).not.toMatch(/\bfair\b/);
    expect(workflow?.sendResult?.delivery).toBe("simulated");
    expect(workflow?.sendResult?.destination.recipient).toBe("Archit");
    expect(workflow?.sendResult?.formattedMessage).toContain("**Subject:**");
    expect(workflow?.verdicts.map(({ verdict }) => verdict.decision)).toEqual([
      "revise",
      "approve",
      "revise",
      "approve",
      "approve",
      "approve",
    ]);

    const fairIssue = workflow?.verdicts
      .flatMap(({ verdict }) =>
        verdict.decision === "revise" ? verdict.issues : [],
      )
      .find(({ code }) => code === "FORBIDDEN_WORD_FAIR");
    expect(fairIssue).toBeDefined();

    const eventTypes = app.orchestrator.events
      .eventsFor(started.id)
      .map(({ type }) => type);
    expect(eventTypes.filter((type) => type === "feedback.routed")).toHaveLength(2);
    expect(eventTypes).toContain("workflow.approved");
    expect(eventTypes).toContain("send.message.sent");
    expect(eventTypes.at(-1)).toBe("workflow.sent");
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

  test("fails the workflow when the send agent cannot deliver", async () => {
    const failingSendAgent: SendAgent = {
      kind: "mock",
      async send() {
        throw new Error("Synthetic Slack delivery failure");
      },
      async abort() {},
      async dispose() {},
      async disposeAll() {},
    };
    runner = startRunnerServer(43601, { sendAgent: failingSendAgent });
    app = await startOrchestratorServer({ port: 43600, runnerUrl: runner.url });

    const workflow = await app.orchestrator.startWorkflow({
      company: { name: "Acme", domain: "acme.example" },
      prospect: { firstName: "Maya", title: "VP of Sales" },
    });
    let state = app.orchestrator.getWorkflow(workflow.id);
    for (
      let poll = 0;
      poll < 100 &&
      (state?.status === "running" || state?.status === "revising");
      poll += 1
    ) {
      await Bun.sleep(20);
      state = app.orchestrator.getWorkflow(workflow.id);
    }

    expect(state?.status).toBe("failed");
    expect(state?.stage).toBe("send");
    expect(state?.lastError).toBe("Synthetic Slack delivery failure");
    expect(
      app.orchestrator.events.eventsFor(workflow.id).at(-1)?.type,
    ).toBe("workflow.failed");
  });
});
