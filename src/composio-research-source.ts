import { z } from "zod";
import {
  ResearchSourceSchema,
  type ResearchSource,
  type Signal,
  type WorkflowRequest,
} from "./contracts";

export const InternalResearchSourceSchema = ResearchSourceSchema.exclude([
  "workflow_input",
]);

export type InternalResearchSource = Exclude<
  ResearchSource,
  "workflow_input"
>;

export const ComposioResearchConfigSchema = z.object({
  apiKey: z.string().min(1, "COMPOSIO_API_KEY is required"),
  userId: z.string().min(1).default("default"),
  timeoutMs: z.number().int().positive().default(30_000),
  posthogProjectId: z.string().min(1).optional(),
  metabaseCardId: z.number().int().positive().optional(),
  metabasePersonTag: z.string().min(1).default("person"),
  metabaseCompanyTag: z.string().min(1).default("company"),
});

export type ComposioResearchConfig = z.infer<
  typeof ComposioResearchConfigSchema
>;

export type ComposioResearchToolCall = {
  source: InternalResearchSource;
  toolSlug: string;
  version: string;
  arguments: Record<string, unknown>;
};

export interface ResearchToolExecutor {
  execute(
    call: ComposioResearchToolCall,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export type ResearchSourcePlan = {
  source: InternalResearchSource;
  toolSlug: string;
  call?: ComposioResearchToolCall;
  unavailableReason?: string;
  extractSignals: (result: unknown) => Signal[];
};

export type ResearchSourcePlanFactory = (
  request: WorkflowRequest,
  config: ComposioResearchConfig,
) => ResearchSourcePlan[];

export function composioResearchConfigFromEnv(): ComposioResearchConfig {
  const metabaseCardId = Bun.env.COMPOSIO_METABASE_CARD_ID;
  return ComposioResearchConfigSchema.parse({
    apiKey: Bun.env.COMPOSIO_API_KEY,
    userId: Bun.env.COMPOSIO_USER_ID ?? "default",
    timeoutMs: Number(Bun.env.COMPOSIO_RESEARCH_TIMEOUT_MS ?? 30_000),
    posthogProjectId: Bun.env.COMPOSIO_POSTHOG_PROJECT_ID || undefined,
    metabaseCardId: metabaseCardId ? Number(metabaseCardId) : undefined,
    metabasePersonTag:
      Bun.env.COMPOSIO_METABASE_PERSON_TAG ?? "person",
    metabaseCompanyTag:
      Bun.env.COMPOSIO_METABASE_COMPANY_TAG ?? "company",
  });
}
