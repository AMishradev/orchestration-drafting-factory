import {
  SendInputSchema,
  SendResultSchema,
  type SendInput,
  type SendProgressEvent,
  type SendResult,
} from "./contracts";
import { formatOutboundForSlack } from "./outbound-format";

export type SendArgs = {
  sessionId: string;
  input: SendInput;
  attempt: number;
  onProgress?: (event: SendProgressEvent) => void;
};

export interface SendAgent {
  readonly kind: "mock" | "composio-slack";
  send(args: SendArgs): Promise<SendResult>;
  abort(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  disposeAll(): Promise<void>;
}

export class MockSendAgent implements SendAgent {
  readonly kind = "mock" as const;

  async send(args: SendArgs): Promise<SendResult> {
    const input = SendInputSchema.parse(args.input);
    const formatted = formatOutboundForSlack(input);
    const slackUserId = "mock-archit";
    const channelId = "mock-dm-archit";

    args.onProgress?.({
      type: "send.recipient.resolved",
      recipient: "Archit",
      slackUserId,
    });
    args.onProgress?.({ type: "send.dm.opened", channelId });
    args.onProgress?.({
      type: "send.message.sent",
      channelId,
      externalMessageId: `mock-${args.sessionId}`,
    });

    return SendResultSchema.parse({
      delivery: "simulated",
      destination: {
        kind: "slack_dm",
        recipient: "Archit",
        slackUserId,
        channelId,
      },
      subject: formatted.subject,
      body: formatted.body,
      formattedMessage: formatted.message,
      externalMessageId: `mock-${args.sessionId}`,
      sentAt: new Date().toISOString(),
    });
  }

  async abort(_sessionId: string): Promise<void> {}
  async dispose(_sessionId: string): Promise<void> {}
  async disposeAll(): Promise<void> {}
}
