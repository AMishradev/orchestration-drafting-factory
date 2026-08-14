import {
  DraftResultSchema,
  type DraftingInput,
  type DraftResult,
  type RevisionVerdict,
} from "./contracts";
import { MockAgentEngine } from "./mock-agent";

export type DraftingProgressHandler = (event: unknown) => void;

export type DraftArgs = {
  sessionId: string;
  input: DraftingInput;
  attempt: number;
  onProgress?: DraftingProgressHandler;
};

export type RevisionArgs = DraftArgs & {
  previousDraft: DraftResult;
  feedback: RevisionVerdict;
};

export interface DraftingAgent {
  readonly kind: "mock" | "pi-rpc";
  draft(args: DraftArgs): Promise<DraftResult>;
  revise(args: RevisionArgs): Promise<DraftResult>;
  abort(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  disposeAll(): Promise<void>;
}

export class MockDraftingAgent implements DraftingAgent {
  readonly kind = "mock" as const;

  constructor(private readonly engine: MockAgentEngine) {}

  async draft(args: DraftArgs): Promise<DraftResult> {
    return DraftResultSchema.parse(await this.engine.run("drafting", args.input));
  }

  revise(args: RevisionArgs): Promise<DraftResult> {
    return this.engine.reviseDraft({
      input: args.input,
      previousDraft: args.previousDraft,
      feedback: args.feedback,
    });
  }

  async abort(_sessionId: string): Promise<void> {}
  async dispose(_sessionId: string): Promise<void> {}
  async disposeAll(): Promise<void> {}
}
