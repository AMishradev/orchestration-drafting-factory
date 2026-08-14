import { z } from "zod";

export const StageSchema = z.enum([
  "research",
  "drafting",
  "review",
  "critic",
  "deep_review",
]);

export type Stage = z.infer<typeof StageSchema>;

export const WorkflowRequestSchema = z.object({
  company: z.object({
    name: z.string().min(1),
    domain: z.string().min(1),
  }),
  prospect: z.object({
    firstName: z.string().min(1),
    title: z.string().min(1),
  }),
});

export type WorkflowRequest = z.infer<typeof WorkflowRequestSchema>;

export const SignalSchema = z.object({
  id: z.string(),
  claim: z.string(),
  sourceUrl: z.string(),
  confidence: z.number().min(0).max(1),
});

export const ResearchResultSchema = z.object({
  companySummary: z.string(),
  signals: z.array(SignalSchema).min(1),
});

export type ResearchResult = z.infer<typeof ResearchResultSchema>;

export const DraftingInputSchema = z.object({
  request: WorkflowRequestSchema,
  research: ResearchResultSchema,
});

export type DraftingInput = z.infer<typeof DraftingInputSchema>;

export const DraftResultSchema = z.object({
  revision: z.number().int().positive(),
  subject: z.string().min(1),
  body: z.string().min(1),
  evidenceSignalIds: z.array(z.string()).min(1),
});

export type DraftResult = z.infer<typeof DraftResultSchema>;

export const IssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  instruction: z.string(),
  severity: z.enum(["warning", "blocking"]),
});

export const VerdictSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    notes: z.array(z.string()).default([]),
  }),
  z.object({
    decision: z.literal("revise"),
    issues: z.array(IssueSchema).min(1),
  }),
  z.object({
    decision: z.literal("reject"),
    reason: z.string().min(1),
  }),
]);

export type Verdict = z.infer<typeof VerdictSchema>;
export type RevisionVerdict = Extract<Verdict, { decision: "revise" }>;

const CommandBaseSchema = z.object({
  messageId: z.string(),
  workflowId: z.string(),
  runId: z.string(),
  attempt: z.number().int().positive(),
});

export const StartRunCommandSchema = CommandBaseSchema.extend({
  type: z.literal("run.start"),
  stage: StageSchema,
  sessionId: z.string(),
  input: z.unknown(),
});

export const FeedbackCommandSchema = CommandBaseSchema.extend({
  type: z.literal("run.feedback"),
  targetSessionId: z.string(),
  feedback: z.object({
    sourceStage: z.enum(["review", "critic", "deep_review"]),
    verdict: z.object({
      decision: z.literal("revise"),
      issues: z.array(IssueSchema).min(1),
    }),
  }),
});

export const RunnerCommandSchema = z.discriminatedUnion("type", [
  StartRunCommandSchema,
  FeedbackCommandSchema,
]);

export type StartRunCommand = z.infer<typeof StartRunCommandSchema>;
export type FeedbackCommand = z.infer<typeof FeedbackCommandSchema>;
export type RunnerCommand = z.infer<typeof RunnerCommandSchema>;

export const RunnerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command.acknowledged"),
    messageId: z.string(),
    workflowId: z.string(),
    runId: z.string(),
  }),
  z.object({
    type: z.literal("run.started"),
    workflowId: z.string(),
    runId: z.string(),
    sessionId: z.string(),
    stage: StageSchema,
    attempt: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("agent.progress"),
    workflowId: z.string(),
    runId: z.string(),
    sessionId: z.string(),
    stage: StageSchema,
    attempt: z.number().int().positive(),
    event: z.unknown(),
  }),
  z.object({
    type: z.literal("run.completed"),
    workflowId: z.string(),
    runId: z.string(),
    sessionId: z.string(),
    stage: StageSchema,
    attempt: z.number().int().positive(),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("run.failed"),
    workflowId: z.string(),
    runId: z.string(),
    sessionId: z.string(),
    stage: StageSchema,
    attempt: z.number().int().positive(),
    error: z.string(),
  }),
]);

export type RunnerEvent = z.infer<typeof RunnerEventSchema>;

export const WorkflowStatusSchema = z.enum([
  "running",
  "revising",
  "approved",
  "rejected",
  "human_review",
  "failed",
]);

export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export type RecordedVerdict = {
  stage: "review" | "critic" | "deep_review";
  attempt: number;
  verdict: Verdict;
};

export type WorkflowState = {
  id: string;
  status: WorkflowStatus;
  stage: Stage;
  draftAttempt: number;
  request: WorkflowRequest;
  research?: ResearchResult;
  draft?: DraftResult;
  verdicts: RecordedVerdict[];
  draftingSessionId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};
