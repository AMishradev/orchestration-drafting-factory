import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { enforceCriticPolicy } from "../src/critic-agent";
import type { EvaluationInput } from "../src/contracts";
import { startOrchestratorServer } from "../src/orchestrator";
import { PiRpcCriticAgent } from "../src/pi-critic-agent";
import { startRunnerServer } from "../src/runner";

let agent: PiRpcCriticAgent | undefined;

afterEach(async () => {
  await agent?.disposeAll();
  agent = undefined;
});

function evaluationInput(): EvaluationInput {
  return {
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
    draft: {
      revision: 2,
      subject: "A knightly enterprise missive",
      body: "Hark Maya! Thy enterprise launch hath reached mine ears. Worth comparing notes?",
      evidenceSignalIds: ["signal-enterprise-launch"],
    },
    priorVerdicts: [
      {
        stage: "review",
        attempt: 2,
        verdict: { decision: "approve", notes: ["Claims are supported."] },
      },
    ],
  };
}

describe("Pi RPC critic adapter", () => {
  test("allows the intentional medieval campaign tone", () => {
    const verdict = enforceCriticPolicy(evaluationInput(), {
      decision: "revise",
      issues: [
        {
          code: "TONE_UNPROFESSIONAL",
          message: "The medieval-knight voice is too whimsical.",
          instruction: "Remove the medieval language.",
          severity: "blocking",
        },
      ],
    });

    expect(verdict).toEqual({
      decision: "approve",
      notes: ["The intentional medieval campaign tone is allowed."],
    });
  });

  test("forces revision when a past date is presented as an upcoming meeting", () => {
    const input = evaluationInput();
    input.draft.body =
      "Our councils are set to convene upon the 18th day of March, at the ninth bell of the morning.";

    const verdict = enforceCriticPolicy(
      input,
      { decision: "approve", notes: ["Looks good."] },
      new Date(2026, 7, 14),
    );

    expect(verdict).toEqual({
      decision: "revise",
      issues: [
        {
          code: "STALE_DATE_REFERENCE",
          message:
            'The email presents an already-passed date as upcoming: "the 18th day of March".',
          instruction:
            "Remove the stale date or replace it only with a current, verified next step. Do not invent a new meeting date.",
          severity: "blocking",
        },
      ],
    });
  });

  test("catches the exact March 18 at 9:00 AM wording", () => {
    const input = evaluationInput();
    input.draft.body =
      "Our meeting is scheduled for March 18 at 9:00 AM PDT. I look forward to it.";

    const verdict = enforceCriticPolicy(
      input,
      { decision: "approve", notes: [] },
      new Date(2026, 7, 14),
    );

    expect(verdict).toMatchObject({
      decision: "revise",
      issues: [
        {
          code: "STALE_DATE_REFERENCE",
          message:
            'The email presents an already-passed date as upcoming: "March 18 at 9:00 AM PDT".',
          severity: "blocking",
        },
      ],
    });
  });

  test("allows past dates that are clearly framed as historical", () => {
    const input = evaluationInput();
    input.draft.body =
      "We spoke on March 18, 2026 about connecting thy product to third-party apps.";

    const verdict = enforceCriticPolicy(
      input,
      { decision: "approve", notes: ["Historical context is supported."] },
      new Date(2026, 7, 14),
    );

    expect(verdict).toEqual({
      decision: "approve",
      notes: ["Historical context is supported."],
    });
  });

  test("allows explicitly future meeting dates", () => {
    const input = evaluationInput();
    input.draft.body = "Our meeting is scheduled for March 18, 2027 at 9:00 AM PDT.";

    const verdict = enforceCriticPolicy(
      input,
      { decision: "approve", notes: ["Future date is valid."] },
      new Date(2026, 7, 14),
    );

    expect(verdict).toEqual({
      decision: "approve",
      notes: ["Future date is valid."],
    });
  });

  test("streams progress and reuses one critic session", async () => {
    const fixture = join(import.meta.dir, "fixtures", "fake-critic-pi.ts");
    agent = new PiRpcCriticAgent({
      command: [Bun.which("bun") ?? "bun", fixture],
      timeoutMs: 3_000,
    });
    const progress: unknown[] = [];

    const first = await agent.critique({
      sessionId: "critic-session-1",
      input: evaluationInput(),
      attempt: 2,
      onProgress: (event) => progress.push(event),
    });
    const inputWithFair = evaluationInput();
    inputWithFair.draft.body =
      "Hark Maya! A fair enterprise launch deserves a worthy missive.";
    const second = await agent.critique({
      sessionId: "critic-session-1",
      input: inputWithFair,
      attempt: 3,
      onProgress: (event) => progress.push(event),
    });
    const third = await agent.critique({
      sessionId: "critic-session-1",
      input: evaluationInput(),
      attempt: 4,
      onProgress: (event) => progress.push(event),
    });

    expect(first.decision).toBe("revise");
    expect(second).toEqual({
      decision: "revise",
      issues: [
        {
          code: "FORBIDDEN_WORD_FAIR",
          message: 'The critic does not allow the word "fair" in the email.',
          instruction: 'Remove or rewrite every occurrence of the word "fair".',
          severity: "blocking",
        },
      ],
    });
    expect(third.decision).toBe("approve");
    expect(
      progress.filter((event) => (event as { type?: string }).type === "message_update"),
    ).toHaveLength(3);
  });

  test("streams critic feedback back to the drafting session end to end", async () => {
    const fixture = join(import.meta.dir, "fixtures", "fake-critic-pi.ts");
    agent = new PiRpcCriticAgent({
      command: [Bun.which("bun") ?? "bun", fixture],
      timeoutMs: 3_000,
    });
    const runner = startRunnerServer(43401, { criticAgent: agent });
    const app = await startOrchestratorServer({
      port: 43400,
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
        poll < 150 &&
        (state?.status === "running" || state?.status === "revising");
        poll += 1
      ) {
        await Bun.sleep(20);
        state = app.orchestrator.getWorkflow(workflow.id);
      }

      expect(runner.draftingEngine).toBe("mock");
      expect(runner.criticEngine).toBe("pi-rpc");
      expect(state?.status).toBe("sent");
      expect(state?.draftAttempt).toBe(3);
      expect(state?.draft?.revision).toBe(3);

      const events = app.orchestrator.events.eventsFor(workflow.id);
      const routedFeedback = events.filter(({ type }) => type === "feedback.routed");
      const criticProgress = events.filter(
        ({ type, data }) =>
          type === "agent.progress" &&
          (data as { stage?: string }).stage === "critic",
      );
      const criticSessions = new Set(
        events
          .filter(
            ({ type, data }) =>
              type === "agent.started" &&
              (data as { stage?: string }).stage === "critic",
          )
          .map(({ data }) => (data as { sessionId: string }).sessionId),
      );

      expect(routedFeedback).toHaveLength(2);
      expect(
        routedFeedback.some(({ data }) =>
          (data as { issues: Array<{ code: string }> }).issues.some(
            ({ code }) => code === "FORBIDDEN_WORD_FAIR",
          ),
        ),
      ).toBeTrue();
      expect(criticProgress.length).toBeGreaterThan(0);
      expect(criticSessions.size).toBe(1);
    } finally {
      await app.stop();
      await runner.stop();
      agent = undefined;
    }
  });
});
