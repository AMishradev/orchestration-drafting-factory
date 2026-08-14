import {
  EvaluationInputSchema,
  VerdictSchema,
  type EvaluationInput,
  type Verdict,
} from "./contracts";
import { MockAgentEngine } from "./mock-agent";

export type CriticProgressHandler = (event: unknown) => void;

export type CriticArgs = {
  sessionId: string;
  input: EvaluationInput;
  attempt: number;
  onProgress?: CriticProgressHandler;
};

export interface CriticAgent {
  readonly kind: "mock" | "pi-rpc";
  critique(args: CriticArgs): Promise<Verdict>;
  abort(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  disposeAll(): Promise<void>;
}

export class MockCriticAgent implements CriticAgent {
  readonly kind = "mock" as const;

  constructor(private readonly engine: MockAgentEngine) {}

  async critique(args: CriticArgs): Promise<Verdict> {
    const input = EvaluationInputSchema.parse(args.input);
    const verdict = VerdictSchema.parse(await this.engine.run("critic", input));
    return enforceCriticPolicy(input, verdict);
  }

  async abort(_sessionId: string): Promise<void> {}
  async dispose(_sessionId: string): Promise<void> {}
  async disposeAll(): Promise<void> {}
}

const forbiddenFairPattern = /\bfair\b/i;

export function enforceCriticPolicy(
  input: EvaluationInput,
  verdict: Verdict,
): Verdict {
  const containsFair = forbiddenFairPattern.test(
    `${input.draft.subject}\n${input.draft.body}`,
  );
  if (!containsFair) return verdict;

  const fairIssue = {
    code: "FORBIDDEN_WORD_FAIR",
    message: 'The critic does not allow the word "fair" in the email.',
    instruction: 'Remove or rewrite every occurrence of the word "fair".',
    severity: "blocking" as const,
  };

  return VerdictSchema.parse({
    decision: "revise",
    issues:
      verdict.decision === "revise"
        ? [
            ...verdict.issues.filter(
              ({ code }) => code !== fairIssue.code,
            ),
            fairIssue,
          ]
        : [fairIssue],
  });
}
