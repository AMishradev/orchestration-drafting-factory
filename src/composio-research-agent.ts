import { Composio } from "@composio/core";
import {
  ResearchInputSchema,
  ResearchResultSchema,
  SignalSchema,
  type ResearchProgressEvent,
  type ResearchResult,
  type Signal,
} from "./contracts";
import type { ResearchAgent, ResearchArgs } from "./research-agent";
import {
  composioResearchConfigFromEnv,
  type ComposioResearchConfig,
  type ComposioResearchToolCall,
  type ResearchSourcePlanFactory,
  type ResearchToolExecutor,
} from "./composio-research-source";
import { buildResearchSourcePlans } from "./research-source-adapters";

type ComposioResearchAgentOptions = {
  config?: ComposioResearchConfig;
  executor?: ResearchToolExecutor;
  sourcePlanFactory?: ResearchSourcePlanFactory;
};

export class ComposioResearchAgent implements ResearchAgent {
  readonly kind = "composio" as const;
  private readonly config: ComposioResearchConfig;
  private readonly executor: ResearchToolExecutor;
  private readonly sourcePlanFactory: ResearchSourcePlanFactory;
  private readonly sessions = new Map<string, AbortController>();

  constructor(options: ComposioResearchAgentOptions = {}) {
    this.config = options.config ?? composioResearchConfigFromEnv();
    this.executor =
      options.executor ?? new ComposioSdkResearchExecutor(this.config);
    this.sourcePlanFactory =
      options.sourcePlanFactory ?? buildResearchSourcePlans;
  }

  async research(args: ResearchArgs): Promise<ResearchResult> {
    const { request } = ResearchInputSchema.parse(args.input);
    const controller = new AbortController();
    this.sessions.set(args.sessionId, controller);
    const plans = this.sourcePlanFactory(request, this.config);

    try {
      const sourceSignals = await Promise.all(
        plans.map(async (plan) => {
          this.progress(args, {
            type: "research.source.started",
            source: plan.source,
            toolSlug: plan.toolSlug,
          });

          if (!plan.call) {
            this.progress(args, {
              type: "research.source.failed",
              source: plan.source,
              error: plan.unavailableReason ?? "Research source is unavailable",
            });
            return [];
          }

          try {
            const result = await this.executor.execute(
              plan.call,
              controller.signal,
            );
            const signals = plan.extractSignals(result);
            for (const signal of signals) {
              this.progress(args, {
                type: "research.signal.available",
                source: plan.source,
                signal,
              });
            }
            this.progress(args, {
              type: "research.source.completed",
              source: plan.source,
              signalCount: signals.length,
            });
            return signals;
          } catch (error) {
            this.progress(args, {
              type: "research.source.failed",
              source: plan.source,
              error: sanitizeError(error, this.config.apiKey),
            });
            return [];
          }
        }),
      );

      const internalSignals = dedupeSignals(sourceSignals.flat());
      const signals =
        internalSignals.length > 0
          ? internalSignals
          : [workflowInputSignal(request)];
      const sourceCount = new Set(
        internalSignals.map(({ source }) => source).filter(Boolean),
      ).size;

      return ResearchResultSchema.parse({
        companySummary:
          internalSignals.length > 0
            ? `${request.company.name} has ${internalSignals.length} relevant internal research signal(s) across ${sourceCount} connected source(s).`
            : `No connected internal source returned a usable match for ${request.company.name}; only workflow-supplied prospect context is available.`,
        signals,
      });
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

  private progress(args: ResearchArgs, event: ResearchProgressEvent) {
    args.onProgress?.(event);
  }
}

class ComposioSdkResearchExecutor implements ResearchToolExecutor {
  private readonly client: Composio;

  constructor(private readonly config: ComposioResearchConfig) {
    this.client = new Composio({ apiKey: config.apiKey });
  }

  async execute(
    call: ComposioResearchToolCall,
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
        connectedAccountId: call.connectedAccountId,
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

function workflowInputSignal(
  request: ResearchArgs["input"]["request"],
): Signal {
  const fullName = [request.prospect.firstName, request.prospect.lastName]
    .filter(Boolean)
    .join(" ");
  return SignalSchema.parse({
    id: "workflow-input-prospect",
    claim: `${fullName} is supplied as ${request.prospect.title} at ${request.company.name} (${request.company.domain}).`,
    sourceUrl: "workflow://request",
    confidence: 1,
    source: "workflow_input",
  });
}

function dedupeSignals(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.source}:${signal.claim.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeError(error: unknown, apiKey: string): string {
  const details = [
    error instanceof Error ? error.message : String(error),
    ...collectErrorDetails(error),
  ];
  const redacted = [...new Set(details)]
    .filter(Boolean)
    .join(" | ")
    .replaceAll(apiKey, "[REDACTED]");
  return redacted.length <= 800 ? redacted : `${redacted.slice(0, 799)}…`;
}

function collectErrorDetails(value: unknown, depth = 0): string[] {
  if (depth > 4 || !value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const details: string[] = [];

  for (const key of [
    "code",
    "status",
    "statusCode",
    "slug",
    "request_id",
    "suggested_fix",
  ]) {
    const field = record[key];
    if (typeof field === "string" || typeof field === "number") {
      details.push(`${key}=${String(field)}`);
    }
  }

  if (typeof record.message === "string") details.push(record.message);
  for (const key of ["cause", "error", "body"]) {
    details.push(...collectErrorDetails(record[key], depth + 1));
  }
  return details;
}
