import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { assertReadOnlyHogql } from "../src/agentic-research-tool-broker";
import type {
  ComposioResearchConfig,
  ComposioResearchToolCall,
  ResearchToolExecutor,
} from "../src/composio-research-source";
import type { ResearchProgressEvent } from "../src/contracts";
import { PiComposioResearchAgent } from "../src/pi-composio-research-agent";

const config: ComposioResearchConfig = {
  apiKey: "agentic-test-key",
  userId: "test-user",
  timeoutMs: 3_000,
  connectedAccountIds: {
    slack: "ca-slack",
    posthog: "ca-posthog",
  },
  posthogProjectId: "57428",
  metabasePersonTag: "person",
  metabaseCompanyTag: "company",
};

class ChainedExecutor implements ResearchToolExecutor {
  readonly calls: ComposioResearchToolCall[] = [];

  async execute(
    call: ComposioResearchToolCall,
    _signal: AbortSignal,
  ): Promise<unknown> {
    this.calls.push(call);
    if (call.toolSlug === "SLACK_SEARCH_MESSAGES") {
      return {
        messages: {
          matches: [
            {
              text: "Renato Nitta can be reached at renato.nitta@crewai.com.",
              username: "archit",
              channel: { name: "growth" },
              permalink: "https://slack.example/archives/growth/1",
            },
          ],
        },
      };
    }
    if (
      call.toolSlug ===
      "POSTHOG_LIST_OR_DELETE_PERSONS_WITH_OPTIONAL_FILTERS"
    ) {
      return {
        results: [
          {
            id: "person-renato",
            distinct_ids: ["renato.nitta@crewai.com"],
            properties: {
              email: "renato.nitta@crewai.com",
              company: "CrewAI",
            },
          },
        ],
        next: null,
      };
    }
    if (call.toolSlug === "POSTHOG_CREATE_QUERY_IN_PROJECT_BY_ID") {
      return {
        data: {
          columns: ["person_count"],
          results: [[22]],
        },
      };
    }
    throw new Error(`Unexpected tool ${call.toolSlug}`);
  }
}

let agent: PiComposioResearchAgent | undefined;

afterEach(async () => {
  await agent?.disposeAll();
  agent = undefined;
});

describe("Pi + Composio research agent", () => {
  test("chains discovered identities into later tool calls in one Pi session", async () => {
    const executor = new ChainedExecutor();
    const fixture = join(import.meta.dir, "fixtures", "fake-research-pi.ts");
    agent = new PiComposioResearchAgent({
      config,
      executor,
      command: [Bun.which("bun") ?? "bun", fixture],
      timeoutMs: 3_000,
      totalTimeoutMs: 10_000,
      maxToolCalls: 5,
    });
    const progress: ResearchProgressEvent[] = [];

    const result = await agent.research({
      sessionId: "agentic-research-1",
      attempt: 1,
      input: {
        request: {
          company: { name: "CrewAI", domain: "crewai.com" },
          prospect: {
            firstName: "Renato",
            lastName: "Nitta",
            title: "Engineering Leader",
          },
        },
      },
      onProgress: (event) => progress.push(event),
    });

    expect(executor.calls.map(({ toolSlug }) => toolSlug)).toEqual([
      "SLACK_SEARCH_MESSAGES",
      "POSTHOG_LIST_OR_DELETE_PERSONS_WITH_OPTIONAL_FILTERS",
      "POSTHOG_CREATE_QUERY_IN_PROJECT_BY_ID",
    ]);
    expect(executor.calls[1]?.arguments.email).toBe(
      "renato.nitta@crewai.com",
    );
    expect(executor.calls[1]?.arguments.project_id).toBe("57428");
    expect(executor.calls[2]?.arguments.query).toEqual({
      kind: "HogQLQuery",
      query:
        "SELECT count() AS person_count FROM persons WHERE lower(toString(properties.email)) LIKE '%@crewai.com'",
    });
    expect(result.signals.some(({ claim }) => claim.includes("22"))).toBeTrue();
    expect(
      progress.some(
        (event) =>
          event.type === "research.identity.discovered" &&
          event.value === "renato.nitta@crewai.com",
      ),
    ).toBeTrue();
    expect(progress.at(-1)).toMatchObject({
      type: "research.completed",
      toolCallCount: 3,
      stopReason: "agent_complete",
    });
  });

  test("rejects mutation, multi-statement, and comment-shaped HogQL", () => {
    expect(() => assertReadOnlyHogql("DELETE FROM persons")).toThrow();
    expect(() => assertReadOnlyHogql("SELECT 1; SELECT 2")).toThrow();
    expect(() => assertReadOnlyHogql("SELECT 1 -- hidden query")).toThrow();
    expect(() => assertReadOnlyHogql("SELECT count() FROM persons")).not.toThrow();
  });
});
