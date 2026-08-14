import { Composio } from "@composio/core";
import { z } from "zod";
import {
  SendInputSchema,
  SendResultSchema,
  type SendResult,
} from "./contracts";
import { formatOutboundForSlack } from "./outbound-format";
import type { SendAgent, SendArgs } from "./send-agent";

const slackToolVersion = "20260721_00";

export const ComposioSlackSendConfigSchema = z
  .object({
    apiKey: z.string().min(1, "COMPOSIO_API_KEY is required"),
    userId: z.string().min(1, "COMPOSIO_USER_ID is required"),
    connectedAccountId: z
      .string()
      .min(1, "COMPOSIO_SLACK_CONNECTED_ACCOUNT_ID is required"),
    recipientUserId: z.string().min(1).optional(),
    recipientQuery: z.string().min(1).default("archit"),
    timeoutMs: z.number().int().positive().default(30_000),
  })
  .refine(
    ({ recipientUserId, recipientQuery }) =>
      Boolean(recipientUserId || recipientQuery),
    "A Slack recipient user ID or search query is required",
  );

export type ComposioSlackSendConfig = z.infer<
  typeof ComposioSlackSendConfigSchema
>;

export type SlackSendToolCall = {
  toolSlug:
    | "SLACK_FIND_USERS"
    | "SLACK_OPEN_DM"
    | "SLACK_SEND_MESSAGE";
  version: typeof slackToolVersion;
  arguments: Record<string, unknown>;
};

export interface SlackSendToolExecutor {
  execute(call: SlackSendToolCall, signal: AbortSignal): Promise<unknown>;
}

type SlackUser = {
  id: string;
  label: string;
};

export class ComposioSlackSendAgent implements SendAgent {
  readonly kind = "composio-slack" as const;
  private readonly config: ComposioSlackSendConfig;
  private readonly executor: SlackSendToolExecutor;
  private readonly sessions = new Map<string, AbortController>();

  constructor(options: {
    config?: ComposioSlackSendConfig;
    executor?: SlackSendToolExecutor;
  } = {}) {
    this.config = options.config ?? composioSlackSendConfigFromEnv();
    this.executor =
      options.executor ?? new ComposioSdkSlackSendExecutor(this.config);
  }

  async send(args: SendArgs): Promise<SendResult> {
    const input = SendInputSchema.parse(args.input);
    const formatted = formatOutboundForSlack(input);
    const controller = new AbortController();
    this.sessions.set(args.sessionId, controller);

    try {
      const recipient = await this.resolveRecipient(controller.signal);
      args.onProgress?.({
        type: "send.recipient.resolved",
        recipient: recipient.label,
        slackUserId: recipient.id,
      });

      const openResult = await this.executor.execute(
        {
          toolSlug: "SLACK_OPEN_DM",
          version: slackToolVersion,
          arguments: {
            users: recipient.id,
            return_im: true,
            prevent_creation: false,
          },
        },
        controller.signal,
      );
      const channelId = extractDmChannelId(openResult);
      args.onProgress?.({ type: "send.dm.opened", channelId });

      const sendResult = await this.executor.execute(
        {
          toolSlug: "SLACK_SEND_MESSAGE",
          version: slackToolVersion,
          arguments: {
            channel: channelId,
            markdown_text: formatted.message,
            unfurl_links: false,
            unfurl_media: false,
          },
        },
        controller.signal,
      );
      const externalMessageId = extractMessageId(sendResult);
      args.onProgress?.({
        type: "send.message.sent",
        channelId,
        ...(externalMessageId ? { externalMessageId } : {}),
      });

      return SendResultSchema.parse({
        delivery: "sent",
        destination: {
          kind: "slack_dm",
          recipient: recipient.label,
          slackUserId: recipient.id,
          channelId,
        },
        subject: formatted.subject,
        body: formatted.body,
        formattedMessage: formatted.message,
        ...(externalMessageId ? { externalMessageId } : {}),
        sentAt: new Date().toISOString(),
      });
    } catch (error) {
      throw new Error(sanitizeSlackSendError(error, this.config.apiKey));
    } finally {
      this.sessions.delete(args.sessionId);
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.sessions.get(sessionId)?.abort();
  }

  async dispose(sessionId: string): Promise<void> {
    this.sessions.get(sessionId)?.abort();
    this.sessions.delete(sessionId);
  }

  async disposeAll(): Promise<void> {
    for (const controller of this.sessions.values()) controller.abort();
    this.sessions.clear();
  }

  private async resolveRecipient(signal: AbortSignal): Promise<SlackUser> {
    if (this.config.recipientUserId) {
      return {
        id: this.config.recipientUserId,
        label: this.config.recipientQuery,
      };
    }

    const result = await this.executor.execute(
      {
        toolSlug: "SLACK_FIND_USERS",
        version: slackToolVersion,
        arguments: {
          search_query: this.config.recipientQuery,
          exact_match: false,
          include_bots: false,
          include_deleted: false,
          limit: 10,
        },
      },
      signal,
    );
    const matches = extractSlackUsers(result);
    if (matches.length !== 1) {
      throw new Error(
        `Slack recipient query "${this.config.recipientQuery}" returned ${matches.length} users; set COMPOSIO_SLACK_RECIPIENT_USER_ID to the intended user before sending`,
      );
    }
    return matches[0]!;
  }
}

export function composioSlackSendConfigFromEnv(): ComposioSlackSendConfig {
  return ComposioSlackSendConfigSchema.parse({
    apiKey: Bun.env.COMPOSIO_API_KEY,
    userId: Bun.env.COMPOSIO_USER_ID,
    connectedAccountId: Bun.env.COMPOSIO_SLACK_CONNECTED_ACCOUNT_ID,
    recipientUserId: Bun.env.COMPOSIO_SLACK_RECIPIENT_USER_ID || undefined,
    recipientQuery: Bun.env.COMPOSIO_SLACK_RECIPIENT_QUERY ?? "archit",
    timeoutMs: Number(Bun.env.COMPOSIO_SLACK_SEND_TIMEOUT_MS ?? 30_000),
  });
}

class ComposioSdkSlackSendExecutor implements SlackSendToolExecutor {
  private readonly client: Composio;

  constructor(private readonly config: ComposioSlackSendConfig) {
    this.client = new Composio({ apiKey: config.apiKey });
  }

  async execute(
    call: SlackSendToolCall,
    signal: AbortSignal,
  ): Promise<unknown> {
    const combinedSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.timeoutMs),
    ]);
    const result = await this.client.tools.execute(
      call.toolSlug,
      {
        userId: this.config.userId,
        connectedAccountId: this.config.connectedAccountId,
        version: call.version,
        arguments: call.arguments,
      },
      { signal: combinedSignal },
    );
    if (!result.successful) {
      throw new Error(result.error ?? `${call.toolSlug} failed`);
    }
    return result.data;
  }
}

function extractSlackUsers(value: unknown): SlackUser[] {
  const members = collectArraysNamed(value, "members")
    .flat()
    .flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const record = candidate as Record<string, unknown>;
      if (typeof record.id !== "string") return [];
      const profile =
        record.profile && typeof record.profile === "object"
          ? (record.profile as Record<string, unknown>)
          : {};
      const label = [
        profile.display_name,
        profile.real_name,
        record.real_name,
        record.name,
      ].find((item): item is string => typeof item === "string" && item.length > 0);
      return [{ id: record.id, label: label ?? record.id }];
    });
  return [...new Map(members.map((member) => [member.id, member])).values()];
}

function collectArraysNamed(
  value: unknown,
  key: string,
  depth = 0,
): unknown[][] {
  if (depth > 6 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectArraysNamed(item, key, depth + 1));
  }
  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([entryKey, entryValue]) => [
    ...(entryKey === key && Array.isArray(entryValue) ? [entryValue] : []),
    ...collectArraysNamed(entryValue, key, depth + 1),
  ]);
}

function extractDmChannelId(value: unknown): string {
  const match = findNestedString(value, (key, candidate) =>
    (key === "id" || key === "channel" || key === "channel_id") &&
    candidate.startsWith("D"),
  );
  if (!match) {
    throw new Error("SLACK_OPEN_DM did not return a DM channel ID");
  }
  return match;
}

function extractMessageId(value: unknown): string | undefined {
  return findNestedString(
    value,
    (key, candidate) =>
      (key === "ts" || key === "message_ts") && /^\d+\.\d+$/.test(candidate),
  );
}

function findNestedString(
  value: unknown,
  predicate: (key: string, value: string) => boolean,
  depth = 0,
): string | undefined {
  if (depth > 6 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findNestedString(item, predicate, depth + 1);
      if (match) return match;
    }
    return undefined;
  }
  for (const [key, candidate] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (typeof candidate === "string" && predicate(key, candidate)) {
      return candidate;
    }
    const match = findNestedString(candidate, predicate, depth + 1);
    if (match) return match;
  }
  return undefined;
}

function sanitizeSlackSendError(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(apiKey, "[REDACTED]");
}
