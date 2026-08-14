import { z } from "zod";
import {
  EvaluationInputSchema,
  VerdictSchema,
  type Verdict,
} from "./contracts";
import {
  enforceCriticPolicy,
  type CriticAgent,
  type CriticArgs,
  type CriticProgressHandler,
} from "./critic-agent";
import { defaultPiCommand } from "./pi-command";
import { parsePiJson } from "./pi-json";
import { PiRpcClient } from "./pi-rpc-client";

type PiCriticAgentOptions = {
  command?: string[] | ((sessionId: string) => string[]);
  timeoutMs?: number;
  validationAttempts?: number;
};

export class PiRpcCriticAgent implements CriticAgent {
  readonly kind = "pi-rpc" as const;
  private readonly sessions = new Map<string, PiRpcClient>();
  private readonly timeoutMs: number;
  private readonly validationAttempts: number;

  constructor(private readonly options: PiCriticAgentOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.validationAttempts = options.validationAttempts ?? 2;
  }

  async critique(args: CriticArgs): Promise<Verdict> {
    const input = EvaluationInputSchema.parse(args.input);
    const prompt = [
      "You are the critic agent for a cold-email workflow.",
      "Evaluate the draft for clarity, concision, relevance, tone, and evidentiary support.",
      'Hard rule: the standalone word "fair" is forbidden in the subject and body, regardless of capitalization.',
      'If "fair" appears, return revise with issue code FORBIDDEN_WORD_FAIR and instruct drafting to remove or rewrite every occurrence.',
      "Treat factual claims as supported only when their signal IDs exist in the supplied research.",
      "Return only one valid JSON verdict using exactly one of these shapes:",
      '{"decision":"approve","notes":["..."]}',
      '{"decision":"revise","issues":[{"code":"...","message":"...","instruction":"...","severity":"warning|blocking"}]}',
      '{"decision":"reject","reason":"..."}',
      "Prefer revise for fixable problems and reject only when the email cannot be safely repaired.",
      "Do not wrap the JSON in Markdown fences.",
      "",
      `Evaluation input: ${JSON.stringify(input)}`,
    ].join("\n");

    const verdict = await this.generate(args.sessionId, prompt, args.onProgress);
    return enforceCriticPolicy(input, verdict);
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
        : this.options.command ?? defaultPiCommand("critic", sessionId);
    const client = new PiRpcClient(command, this.timeoutMs);
    this.sessions.set(sessionId, client);
    return client;
  }

  private async generate(
    sessionId: string,
    initialPrompt: string,
    onProgress?: CriticProgressHandler,
  ): Promise<Verdict> {
    const client = this.getClient(sessionId);
    const unsubscribe = onProgress ? client.onEvent(onProgress) : () => {};
    let prompt = initialPrompt;

    try {
      for (let attempt = 1; attempt <= this.validationAttempts; attempt += 1) {
        const text = await client.prompt(prompt);

        try {
          return VerdictSchema.parse(parsePiJson(text));
        } catch (error) {
          if (attempt === this.validationAttempts) throw error;
          const detail =
            error instanceof z.ZodError
              ? JSON.stringify(error.issues)
              : error instanceof Error
                ? error.message
                : String(error);
          prompt = [
            "Your previous verdict failed runtime validation.",
            `Validation error: ${detail}`,
            "Return only a corrected raw JSON approve, revise, or reject verdict.",
          ].join("\n");
        }
      }
    } finally {
      unsubscribe();
    }

    throw new Error("Pi failed to produce a valid critic verdict");
  }
}
