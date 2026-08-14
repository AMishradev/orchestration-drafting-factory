import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { DraftingInput, RevisionVerdict } from "../src/contracts";
import { startOrchestratorServer } from "../src/orchestrator";
import { PiRpcDraftingAgent } from "../src/pi-drafting-agent";
import { startRunnerServer } from "../src/runner";

let agent: PiRpcDraftingAgent | undefined;

afterEach(async () => {
  await agent?.disposeAll();
  agent = undefined;
});

describe("Pi RPC drafting adapter", () => {
  test("drafts and revises through one persistent RPC session", async () => {
    const fixture = join(import.meta.dir, "fixtures", "fake-pi.ts");
    agent = new PiRpcDraftingAgent({
      command: [Bun.which("bun") ?? "bun", fixture],
      timeoutMs: 3_000,
    });

    const input: DraftingInput = {
      request: {
        company: { name: "Acme", domain: "acme.example" },
        prospect: { firstName: "Maya", title: "VP of Sales" },
      },
      research: {
        companySummary: "Acme is launching an enterprise offering.",
        signals: [
          {
            id: "signal-enterprise-launch",
            claim: "Acme launched a new enterprise offering",
            sourceUrl: "https://acme.example/news/enterprise",
            confidence: 0.94,
          },
        ],
      },
    };
    const progress: unknown[] = [];
    const first = await agent.draft({
      sessionId: "draft-session-1",
      input,
      attempt: 1,
      onProgress: (event) => progress.push(event),
    });

    const feedback: RevisionVerdict = {
      decision: "revise",
      issues: [
        {
          code: "UNSUPPORTED_CLAIM",
          message: "Remove the unsupported claim.",
          instruction: "Use only the enterprise-launch signal.",
          severity: "blocking",
        },
      ],
    };
    const revised = await agent.revise({
      sessionId: "draft-session-1",
      input,
      attempt: 2,
      previousDraft: first,
      feedback,
      onProgress: (event) => progress.push(event),
    });

    expect(first.revision).toBe(1);
    expect(first.body).toContain("Hark Maya");
    expect(revised.revision).toBe(2);
    expect(revised.body).toContain("removed the disputed claim");
    expect(progress.some((event) => (event as { type?: string }).type === "message_update")).toBeTrue();
  });

  test("routes review feedback through the Pi adapter end to end", async () => {
    const fixture = join(import.meta.dir, "fixtures", "fake-pi.ts");
    agent = new PiRpcDraftingAgent({
      command: [Bun.which("bun") ?? "bun", fixture],
      timeoutMs: 3_000,
    });
    const runner = startRunnerServer(43301, { draftingAgent: agent });
    const app = await startOrchestratorServer({
      port: 43300,
      runnerUrl: runner.url,
    });

    try {
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

      expect(runner.draftingEngine).toBe("pi-rpc");
      expect(state?.status).toBe("approved");
      expect(state?.draftAttempt).toBe(2);
      expect(state?.draft?.revision).toBe(2);
      expect(state?.draft?.body).toContain("removed the disputed claim");

      const eventTypes = app.orchestrator.events
        .eventsFor(workflow.id)
        .map(({ type }) => type);
      expect(eventTypes).toContain("agent.progress");
      expect(eventTypes).toContain("feedback.routed");
    } finally {
      await app.stop();
      await runner.stop();
      agent = undefined;
    }
  });
});
