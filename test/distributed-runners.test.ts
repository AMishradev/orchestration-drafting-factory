import { afterEach, describe, expect, test } from "bun:test";
import type { RunnerCommand } from "../src/contracts";
import { startOrchestratorServer } from "../src/orchestrator";
import { RunnerConnection } from "../src/runner-connection";
import { startRunnerServer, type RunnerServer } from "../src/runner";
import { runnerCanHandle } from "../src/runner-role";

const runnerToken = "test-runner-token";
const apiToken = "test-api-token";
let runners: RunnerServer[] = [];
let app: Awaited<ReturnType<typeof startOrchestratorServer>> | undefined;

afterEach(async () => {
  if (app) await app.stop();
  await Promise.all(runners.map((runner) => runner.stop()));
  app = undefined;
  runners = [];
});

describe("distributed runner topology", () => {
  test("routes each stage to its authenticated role runner", async () => {
    const research = startRunnerServer(43701, {
      role: "research",
      authToken: runnerToken,
    });
    const drafting = startRunnerServer(43702, {
      role: "drafting",
      authToken: runnerToken,
    });
    const critic = startRunnerServer(43703, {
      role: "critic",
      authToken: runnerToken,
    });
    const send = startRunnerServer(43704, {
      role: "send",
      authToken: runnerToken,
    });
    runners = [research, drafting, critic, send];
    app = await startOrchestratorServer({
      port: 43700,
      apiToken,
      runnerAuthToken: runnerToken,
      runnerUrls: {
        research: research.url,
        drafting: drafting.url,
        critic: critic.url,
        send: send.url,
      },
    });

    const unauthorized = await fetch(`${app.url}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: { name: "Acme", domain: "acme.example" },
        prospect: { firstName: "Maya", title: "VP of Sales" },
      }),
    });
    expect(unauthorized.status).toBe(401);

    const response = await fetch(`${app.url}/workflows`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        company: { name: "Acme", domain: "acme.example" },
        prospect: { firstName: "Maya", title: "VP of Sales" },
      }),
    });
    expect(response.status).toBe(202);
    const workflow = (await response.json()) as { id: string };
    let state = app.orchestrator.getWorkflow(workflow.id);
    for (
      let poll = 0;
      poll < 150 &&
      (state?.status === "running" || state?.status === "revising");
      poll += 1
    ) {
      await Bun.sleep(20);
      state = app.orchestrator.getWorkflow(workflow.id);
    }

    expect(state?.status).toBe("sent");
    expect(state?.draftAttempt).toBe(3);
    expect(app.orchestrator.runnerStates()).toEqual({
      research: "connected",
      drafting: "connected",
      critic: "connected",
      send: "connected",
    });
    const stages = app.orchestrator.events
      .eventsFor(workflow.id)
      .filter(({ type }) => type === "agent.completed")
      .map(({ data }) => (data as { stage: string }).stage);
    expect(stages).toEqual([
      "research",
      "drafting",
      "review",
      "drafting",
      "review",
      "critic",
      "drafting",
      "review",
      "critic",
      "deep_review",
      "send",
    ]);
  });

  test("rejects commands sent to the wrong runner role", () => {
    const draftingCommand: RunnerCommand = {
      type: "run.start",
      messageId: "message-1",
      workflowId: "workflow-1",
      runId: "run-1",
      attempt: 1,
      sessionId: "draft-1",
      stage: "drafting",
      input: {},
    };
    expect(runnerCanHandle("research", draftingCommand)).toBeFalse();
    expect(runnerCanHandle("drafting", draftingCommand)).toBeTrue();
    expect(runnerCanHandle("all", draftingCommand)).toBeTrue();
  });

  test("reconnects a role connection after its runner restarts", async () => {
    let runner = startRunnerServer(43801, {
      role: "research",
      authToken: runnerToken,
    });
    runners = [runner];
    const disconnects: string[] = [];
    const connection = new RunnerConnection({
      role: "research",
      url: runner.url,
      authToken: runnerToken,
      onMessage: () => {},
      onDisconnect: (_role, reason) => disconnects.push(reason),
    });

    await connection.ready();
    expect(connection.state).toBe("connected");
    await runner.stop();
    runners = [];
    for (let poll = 0; poll < 50 && connection.state !== "disconnected"; poll += 1) {
      await Bun.sleep(10);
    }
    expect(connection.state).toBe("disconnected");

    runner = startRunnerServer(43801, {
      role: "research",
      authToken: runnerToken,
    });
    runners = [runner];
    for (let poll = 0; poll < 150 && connection.state !== "connected"; poll += 1) {
      await Bun.sleep(20);
    }
    expect(connection.state).toBe("connected");
    expect(disconnects.length).toBeGreaterThan(0);
    connection.stop();
  });
});
