import { z } from "zod";
import {
  ResearchSourceSchema,
  SignalSchema,
  type ResearchSource,
  type Signal,
} from "./contracts";

const BoundedQuerySchema = z.string().trim().min(1).max(2_000);

export const PosthogPropertyFilterSchema = z.object({
  key: z.string().trim().min(1).max(120),
  value: z.union([
    z.string().max(500),
    z.array(z.string().max(500)).min(1).max(20),
  ]),
  operator: z
    .enum([
      "exact",
      "is_not",
      "icontains",
      "not_icontains",
      "regex",
      "not_regex",
      "is_set",
      "is_not_set",
    ])
    .default("exact"),
});

export const ResearchToolRequestSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("slack_search"),
    query: BoundedQuerySchema,
    limit: z.number().int().min(1).max(100).default(20),
  }),
  z.object({
    tool: z.literal("granola_search"),
    query: BoundedQuerySchema,
  }),
  z
    .object({
      tool: z.literal("fireflies_search"),
      email: z.string().email().optional(),
      title: z.string().trim().min(1).max(300).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .refine(({ email, title }) => Boolean(email || title), {
      message: "Fireflies requires an email or title query",
    }),
  z.object({
    tool: z.literal("salesforce_search"),
    query: BoundedQuerySchema,
  }),
  z
    .object({
      tool: z.literal("posthog_people"),
      email: z.string().email().optional(),
      search: z.string().trim().min(1).max(500).optional(),
      propertyFilters: z.array(PosthogPropertyFilterSchema).max(10).optional(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .refine(
      ({ email, search, propertyFilters }) =>
        Boolean(email || search || propertyFilters?.length),
      { message: "PostHog people requires an email, search, or property filter" },
    ),
  z.object({
    tool: z.literal("posthog_hogql"),
    query: BoundedQuerySchema,
  }),
]);

export type ResearchToolRequest = z.infer<typeof ResearchToolRequestSchema>;
export type ResearchToolName = ResearchToolRequest["tool"];
export const ResearchToolNameSchema = z.enum([
  "slack_search",
  "granola_search",
  "fireflies_search",
  "salesforce_search",
  "posthog_people",
  "posthog_hogql",
]);

export const ResearchDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("tool"),
    purpose: z.string().trim().min(1).max(500),
    request: ResearchToolRequestSchema,
  }),
  z.object({
    action: z.literal("complete"),
    companySummary: z.string().trim().min(1).max(1_500),
    selectedSignalIds: z.array(z.string()).max(30),
  }),
]);

export type ResearchDecision = z.infer<typeof ResearchDecisionSchema>;
export type ResearchToolDecision = Extract<
  ResearchDecision,
  { action: "tool" }
>;
export type ResearchCompletionDecision = Extract<
  ResearchDecision,
  { action: "complete" }
>;

export type DiscoveredIdentity = {
  type: "email" | "domain";
  value: string;
  source: Exclude<ResearchSource, "workflow_input">;
};

export const ResearchToolObservationSchema = z.object({
  callId: z.string(),
  source: ResearchSourceSchema.exclude(["workflow_input"]),
  tool: ResearchToolNameSchema,
  request: ResearchToolRequestSchema,
  resultCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().optional(),
  signals: z.array(SignalSchema),
  identities: z.array(
    z.object({
      type: z.enum(["email", "domain"]),
      value: z.string(),
      source: ResearchSourceSchema.exclude(["workflow_input"]),
    }),
  ),
});

export type ResearchToolObservation = Omit<
  z.infer<typeof ResearchToolObservationSchema>,
  "signals"
> & { signals: Signal[] };
