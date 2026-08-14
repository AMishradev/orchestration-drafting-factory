import { afterEach, describe, expect, test } from "bun:test";
import { ComposioResearchAgent } from "../src/composio-research-agent";
import { ComposioResearchConfigSchema } from "../src/composio-research-source";
import type {
  ComposioResearchConfig,
  ComposioResearchToolCall,
  ResearchToolExecutor,
} from "../src/composio-research-source";
import type { ResearchProgressEvent } from "../src/contracts";
import { startOrchestratorServer } from "../src/orchestrator";
import type { RunnerServer } from "../src/runner";
import { startRunnerServer } from "../src/runner";

const config: ComposioResearchConfig = {
  apiKey: "test-key-never-sent",
  userId: "test-user",
  timeoutMs: 3_000,
  connectedAccountIds: {
    slack: "ca-slack",
    granola: "ca-granola",
    fireflies: "ca-fireflies",
  },
  posthogProjectId: "12345",
  metabaseCardId: 77,
  metabasePersonTag: "person",
  metabaseCompanyTag: "company",
};

class FakeResearchExecutor implements ResearchToolExecutor {
  readonly calls: ComposioResearchToolCall[] = [];

  constructor(
    private readonly failures = new Set<string>(),
  ) {}

  async execute(
    call: ComposioResearchToolCall,
    _signal: AbortSignal,
  ): Promise<unknown> {
    this.calls.push(call);
    if (this.failures.has(call.toolSlug)) {
      throw Object.assign(
        new Error(`Synthetic failure containing ${config.apiKey}`),
        {
          code: "TS-SDK::TOOL_EXECUTION_ERROR",
          statusCode: 401,
          cause: {
            error: {
              error: {
                request_id: "request-test-123",
                suggested_fix: "Use the connected account user ID",
              },
            },
          },
        },
      );
    }
    await Bun.sleep(
      {
        slack: 30,
        granola: 25,
        fireflies: 20,
        salesforce: 15,
        posthog: 10,
        metabase: 5,
      }[call.source],
    );

    return {
      SLACK_SEARCH_MESSAGES: {
        messages: {
          matches: [
            {
              text: "Maya asked about consolidating outbound research before the next launch.",
              username: "alex",
              channel: { name: "sales" },
              permalink: "https://slack.example/archives/sales/1",
            },
          ],
        },
      },
      GRANOLA_MCP_QUERY_GRANOLA_MEETINGS: {
        data: "Meeting notes: Maya owns the enterprise outbound evaluation and wants evidence-backed personalization.",
      },
      FIREFLIES_GET_TRANSCRIPTS: {
        transcripts: [
          {
            title: "Acme outbound planning",
            date: "2026-08-01",
            summary: { overview: "The team wants to reduce manual research time." },
            meeting_link: "https://fireflies.example/transcript/1",
          },
        ],
      },
      SALESFORCE_EXECUTE_SOSL_SEARCH: {
        searchRecords: [
          {
            attributes: { type: "Contact", url: "/Contact/003" },
            FirstName: "Maya",
            LastName: "Rivera",
            Email: "maya@acme.example",
            Title: "VP of Sales",
          },
        ],
      },
      POSTHOG_LIST_OR_DELETE_PERSONS_WITH_OPTIONAL_FILTERS: {
        results: [
          {
            id: "person-1",
            distinct_ids: ["maya@acme.example"],
            properties: {
              email: "maya@acme.example",
              company: "Acme",
              plan: "enterprise",
            },
          },
        ],
      },
      METABASE_CREATE_CARD_QUERY1: {
        data: {
          cols: [{ name: "account_note" }],
          rows: [["Acme is evaluating an internal outbound automation project."]],
        },
      },
    }[call.toolSlug];
  }
}

let runner: RunnerServer | undefined;
let app: Awaited<ReturnType<typeof startOrchestratorServer>> | undefined;

afterEach(async () => {
  if (app) await app.stop();
  if (runner) await runner.stop();
  app = undefined;
  runner = undefined;
});

describe("Composio research agent", () => {
  test("fans out read-only sources and streams normalized signals", async () => {
    const executor = new FakeResearchExecutor();
    const agent = new ComposioResearchAgent({ config, executor });
    const progress: ResearchProgressEvent[] = [];

    const result = await agent.research({
      sessionId: "research-session-1",
      attempt: 1,
      input: {
        request: {
          company: { name: "Acme", domain: "acme.example" },
          prospect: {
            firstName: "Maya",
            lastName: "Rivera",
            email: "maya@acme.example",
            title: "VP of Sales",
          },
        },
      },
      onProgress: (event) => progress.push(event),
    });

    expect(executor.calls).toHaveLength(6);
    expect(new Set(executor.calls.map(({ source }) => source))).toEqual(
      new Set([
        "slack",
        "granola",
        "fireflies",
        "salesforce",
        "posthog",
        "metabase",
      ]),
    );
    expect(executor.calls.every(({ version }) => /^\d{8}_\d{2}$/.test(version))).toBeTrue();
    const granolaCall = executor.calls.find(({ source }) => source === "granola");
    expect(granolaCall?.arguments.query).toContain("Match ANY");
    expect(granolaCall?.arguments.query).toContain('"Maya Rivera"');
    expect(granolaCall?.connectedAccountId).toBe("ca-granola");
    expect(result.signals).toHaveLength(6);
    expect(new Set(result.signals.map(({ source }) => source))).toEqual(
      new Set([
        "slack",
        "granola",
        "fireflies",
        "salesforce",
        "posthog",
        "metabase",
      ]),
    );
    expect(
      progress.filter(({ type }) => type === "research.signal.available"),
    ).toHaveLength(6);
    expect(
      progress.filter(({ type }) => type === "research.source.completed"),
    ).toHaveLength(6);
    expect(
      progress.filter(({ type }) => type === "research.source.failed"),
    ).toHaveLength(0);
  });

  test("makes streamed signals available in workflow context", async () => {
    const executor = new FakeResearchExecutor();
    const researchAgent = new ComposioResearchAgent({ config, executor });
    runner = startRunnerServer(43501, { researchAgent });
    app = await startOrchestratorServer({
      port: 43500,
      runnerUrl: runner.url,
    });

    const workflow = await app.orchestrator.startWorkflow({
      company: { name: "Acme", domain: "acme.example" },
      prospect: {
        firstName: "Maya",
        lastName: "Rivera",
        email: "maya@acme.example",
        title: "VP of Sales",
      },
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

    expect(runner.researchEngine).toBe("composio");
    expect(state?.status).toBe("sent");
    expect(state?.researchSignals).toHaveLength(6);
    expect(state?.research?.signals).toEqual(state?.researchSignals);

    const events = app.orchestrator.events.eventsFor(workflow.id);
    expect(
      events.filter(({ type }) => type === "research.signal.available"),
    ).toHaveLength(6);
    expect(
      events.filter(({ type }) => type === "research.source.completed"),
    ).toHaveLength(6);
    expect(events.some(({ type }) => type === "agent.progress")).toBeTrue();
  });

  test("isolates source failures and redacts the project key", async () => {
    const executor = new FakeResearchExecutor(
      new Set(["SLACK_SEARCH_MESSAGES"]),
    );
    const partialConfig: ComposioResearchConfig = {
      ...config,
      posthogProjectId: undefined,
      metabaseCardId: undefined,
    };
    const agent = new ComposioResearchAgent({
      config: partialConfig,
      executor,
    });
    const progress: ResearchProgressEvent[] = [];

    const result = await agent.research({
      sessionId: "research-session-partial",
      attempt: 1,
      input: {
        request: {
          company: { name: "Acme", domain: "acme.example" },
          prospect: {
            firstName: "Maya",
            email: "maya@acme.example",
            title: "VP of Sales",
          },
        },
      },
      onProgress: (event) => progress.push(event),
    });

    expect(result.signals.map(({ source }) => source).sort()).toEqual([
      "fireflies",
      "granola",
      "salesforce",
    ]);
    const failures = progress.filter(
      (event) => event.type === "research.source.failed",
    );
    expect(failures).toHaveLength(3);
    expect(JSON.stringify(failures)).not.toContain(config.apiKey);
    expect(JSON.stringify(failures)).toContain("[REDACTED]");
    expect(JSON.stringify(failures)).toContain("request_id=request-test-123");
    expect(JSON.stringify(failures)).toContain(
      "suggested_fix=Use the connected account user ID",
    );
  });

  test("requires an explicit connected-account user ID", () => {
    expect(
      ComposioResearchConfigSchema.safeParse({
        ...config,
        userId: "",
      }).success,
    ).toBeFalse();
  });
});
