import { describe, expect, test } from "bun:test";
import {
  ComposioSlackSendAgent,
  type ComposioSlackSendConfig,
  type SlackSendToolCall,
  type SlackSendToolExecutor,
} from "../src/composio-slack-send-agent";
import type { SendInput, SendProgressEvent } from "../src/contracts";

const config: ComposioSlackSendConfig = {
  apiKey: "test-key-never-sent",
  userId: "test-user",
  connectedAccountId: "ca-slack",
  recipientQuery: "archit",
  timeoutMs: 3_000,
};

const input: SendInput = {
  request: {
    company: { name: "innoGPT", domain: "innogpt.de" },
    prospect: {
      firstName: "Mike",
      lastName: "Koene",
      title: "Lead Developer",
    },
  },
  research: {
    companySummary: "Internal context is available.",
    signals: [
      {
        id: "signal-1",
        claim: "Mike discussed internal AI workflows",
        sourceUrl: "https://example.com/signal",
        confidence: 0.9,
      },
    ],
  },
  draft: {
    revision: 1,
    subject: "A knightly idea — for innoGPT;",
    body: "Good morrow, Mike —\n\nI bring a thought; one fit for thy team.\n\nWorth a chat?",
    evidenceSignalIds: ["signal-1"],
  },
};

class FakeSlackExecutor implements SlackSendToolExecutor {
  readonly calls: SlackSendToolCall[] = [];

  constructor(private readonly userCount = 1) {}

  async execute(call: SlackSendToolCall): Promise<unknown> {
    this.calls.push(call);
    if (call.toolSlug === "SLACK_FIND_USERS") {
      return {
        results: [
          {
            response: {
              data: {
                members: Array.from({ length: this.userCount }, (_, index) => ({
                  id: `UARCHIT${index + 1}`,
                  profile: { display_name: index === 0 ? "Archit" : "Archit 2" },
                })),
              },
            },
          },
        ],
      };
    }
    if (call.toolSlug === "SLACK_OPEN_DM") {
      return { channel: { id: "DARCHIT1" } };
    }
    return { ok: true, channel: "DARCHIT1", ts: "1723500000.123456" };
  }
}

describe("Composio Slack send agent", () => {
  test("cleans, formats, and sends the approved outbound to one resolved user", async () => {
    const executor = new FakeSlackExecutor();
    const agent = new ComposioSlackSendAgent({ config, executor });
    const progress: SendProgressEvent[] = [];

    const result = await agent.send({
      sessionId: "send-1",
      attempt: 1,
      input,
      onProgress: (event) => progress.push(event),
    });

    expect(executor.calls.map(({ toolSlug }) => toolSlug)).toEqual([
      "SLACK_FIND_USERS",
      "SLACK_OPEN_DM",
      "SLACK_SEND_MESSAGE",
    ]);
    expect(executor.calls.every(({ version }) => version === "20260721_00")).toBeTrue();
    expect(executor.calls[1]?.arguments.users).toBe("UARCHIT1");
    expect(executor.calls[2]?.arguments.channel).toBe("DARCHIT1");
    expect(executor.calls[2]?.arguments.markdown_text).toBe(result.formattedMessage);
    expect(result.delivery).toBe("sent");
    expect(result.destination.recipient).toBe("Archit");
    expect(result.externalMessageId).toBe("1723500000.123456");
    expect(`${result.subject}\n${result.body}`).not.toMatch(/[—–;]/);
    expect(result.formattedMessage).toContain("**Subject:** A knightly idea, for innoGPT,");
    expect(result.formattedMessage).toContain("**Body:**\nGood morrow, Mike,");
    expect(progress.map(({ type }) => type)).toEqual([
      "send.recipient.resolved",
      "send.dm.opened",
      "send.message.sent",
    ]);
  });

  test("refuses to send when a name query is ambiguous", async () => {
    const executor = new FakeSlackExecutor(2);
    const agent = new ComposioSlackSendAgent({ config, executor });

    await expect(
      agent.send({ sessionId: "send-ambiguous", attempt: 1, input }),
    ).rejects.toThrow("returned 2 users");
    expect(executor.calls.map(({ toolSlug }) => toolSlug)).toEqual([
      "SLACK_FIND_USERS",
    ]);
  });

  test("uses an explicit Slack user ID without searching by name", async () => {
    const executor = new FakeSlackExecutor();
    const agent = new ComposioSlackSendAgent({
      config: { ...config, recipientUserId: "UARCHIT-EXACT" },
      executor,
    });

    const result = await agent.send({
      sessionId: "send-exact",
      attempt: 1,
      input,
    });

    expect(executor.calls.map(({ toolSlug }) => toolSlug)).toEqual([
      "SLACK_OPEN_DM",
      "SLACK_SEND_MESSAGE",
    ]);
    expect(executor.calls[0]?.arguments.users).toBe("UARCHIT-EXACT");
    expect(result.destination.slackUserId).toBe("UARCHIT-EXACT");
  });
});
