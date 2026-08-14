import { z } from "zod";
import {
  DraftResultSchema,
  DraftingInputSchema,
  type DraftResult,
} from "./contracts";
import type {
  DraftArgs,
  DraftingAgent,
  DraftingProgressHandler,
  RevisionArgs,
} from "./drafting-agent";
import { PiRpcClient } from "./pi-rpc-client";

type PiDraftingAgentOptions = {
  command?: string[] | ((sessionId: string) => string[]);
  timeoutMs?: number;
  validationAttempts?: number;
};

export class PiRpcDraftingAgent implements DraftingAgent {
  readonly kind = "pi-rpc" as const;
  private readonly sessions = new Map<string, PiRpcClient>();
  private readonly timeoutMs: number;
  private readonly validationAttempts: number;

  constructor(private readonly options: PiDraftingAgentOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.validationAttempts = options.validationAttempts ?? 2;
  }

  async draft(args: DraftArgs): Promise<DraftResult> {
    const input = DraftingInputSchema.parse(args.input);
    const prompt = [
      "You are the drafting agent for a cold-email workflow.",
      "Write a short outbound email in a whimsical tone, as if you are a medieval knight.",
      "Use only the supplied research signals for personalized factual claims.",
      "Return only valid JSON with this exact shape:",
      '{"revision":1,"subject":"...","body":"...","evidenceSignalIds":["signal-id"]}',
      "Do not wrap the JSON in Markdown fences.",
      "",
      `Input: ${JSON.stringify(input)}`,
    ].join("\n");

    return this.generate(args.sessionId, prompt, args.onProgress);
  }

  async revise(args: RevisionArgs): Promise<DraftResult> {
    const input = DraftingInputSchema.parse(args.input);
    const prompt = [
      "Revise the previous outbound email using the review feedback.",
      "Keep the whimsical medieval-knight tone.",
      "Use only supplied research signals for factual claims.",
      `Set revision to ${args.previousDraft.revision + 1}.`,
      "Return only valid JSON with keys revision, subject, body, and evidenceSignalIds.",
      "Do not wrap the JSON in Markdown fences.",
      "",
      `Input: ${JSON.stringify(input)}`,
      `Previous draft: ${JSON.stringify(args.previousDraft)}`,
      `Review feedback: ${JSON.stringify(args.feedback)}`,
    ].join("\n");

    return this.generate(args.sessionId, prompt, args.onProgress);
  }

  async abort(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.abort();
  }

  async dispose(sessionId: string): Promise<void> {
    const client = this.sessions.get(sessionId);
    if (!client) return;
    this.sessions.delete(sessionId);
    await client.close();
  }

  async disposeAll(): Promise<void> {
    const clients = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(clients.map((client) => client.close()));
  }

  private getClient(sessionId: string): PiRpcClient {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const command =
      typeof this.options.command === "function"
        ? this.options.command(sessionId)
        : this.options.command ?? defaultPiCommand(sessionId);
    const client = new PiRpcClient(command, this.timeoutMs);
    this.sessions.set(sessionId, client);
    return client;
  }

  private async generate(
    sessionId: string,
    initialPrompt: string,
    onProgress?: DraftingProgressHandler,
  ): Promise<DraftResult> {
    const client = this.getClient(sessionId);
    const unsubscribe = onProgress ? client.onEvent(onProgress) : () => {};
    let prompt = initialPrompt;

    try {
      for (let attempt = 1; attempt <= this.validationAttempts; attempt += 1) {
        const text = await client.prompt(prompt);

        try {
          return DraftResultSchema.parse(parseJson(text));
        } catch (error) {
          if (attempt === this.validationAttempts) throw error;
          const detail =
            error instanceof z.ZodError
              ? JSON.stringify(error.issues)
              : error instanceof Error
                ? error.message
                : String(error);
          prompt = [
            "Your previous response failed runtime validation.",
            `Validation error: ${detail}`,
            "Return the corrected email as raw JSON only, with keys revision, subject, body, and evidenceSignalIds.",
          ].join("\n");
        }
      }
    } finally {
      unsubscribe();
    }

    throw new Error("Pi failed to produce a valid draft");
  }
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function defaultPiCommand(sessionId: string): string[] {
  const command = [
    Bun.env.PI_COMMAND ?? "pi",
    "--mode",
    "rpc",
    "--no-session",
    "--name",
    `drafting-${sessionId}`,
  ];

  if (Bun.env.PI_PROVIDER) command.push("--provider", Bun.env.PI_PROVIDER);
  if (Bun.env.PI_MODEL) command.push("--model", Bun.env.PI_MODEL);
  return command;
}
