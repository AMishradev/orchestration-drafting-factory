import {
  ResearchInputSchema,
  ResearchResultSchema,
  type ResearchInput,
  type ResearchProgressEvent,
  type ResearchResult,
} from "./contracts";
import { MockAgentEngine } from "./mock-agent";

export type ResearchProgressHandler = (
  event: ResearchProgressEvent,
) => void;

export type ResearchArgs = {
  sessionId: string;
  input: ResearchInput;
  attempt: number;
  onProgress?: ResearchProgressHandler;
};

export interface ResearchAgent {
  readonly kind: "mock" | "composio";
  research(args: ResearchArgs): Promise<ResearchResult>;
  abort(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  disposeAll(): Promise<void>;
}

export class MockResearchAgent implements ResearchAgent {
  readonly kind = "mock" as const;

  constructor(private readonly engine: MockAgentEngine) {}

  async research(args: ResearchArgs): Promise<ResearchResult> {
    const input = ResearchInputSchema.parse(args.input);
    return ResearchResultSchema.parse(
      await this.engine.run("research", input),
    );
  }

  async abort(_sessionId: string): Promise<void> {}
  async dispose(_sessionId: string): Promise<void> {}
  async disposeAll(): Promise<void> {}
}
