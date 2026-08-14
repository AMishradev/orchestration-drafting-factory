import {
  DraftResultSchema,
  FeedbackCommandSchema,
  ResearchResultSchema,
  RunnerEventSchema,
  StartRunCommandSchema,
  VerdictSchema,
  WorkflowRequestSchema,
  type RevisionVerdict,
  type Stage,
  type WorkflowRequest,
  type WorkflowState,
} from "./contracts";
import { EventHub, formatSse } from "./event-hub";

const terminalStatuses = new Set([
  "approved",
  "rejected",
  "human_review",
  "failed",
]);

export class FactoryOrchestrator {
  readonly events = new EventHub();
  private readonly workflows = new Map<string, WorkflowState>();
  private readonly socket: WebSocket;
  private readonly socketReady: Promise<void>;

  constructor(
    runnerUrl: string,
    private readonly maxDraftAttempts = 3,
  ) {
    this.socket = new WebSocket(runnerUrl);
    this.socketReady = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener(
        "error",
        () => reject(new Error(`Unable to connect to runner at ${runnerUrl}`)),
        { once: true },
      );
    });
    this.socket.addEventListener("message", (event) => {
      void this.handleRunnerEvent(String(event.data));
    });
  }

  ready(): Promise<void> {
    return this.socketReady;
  }

  listWorkflows(): WorkflowState[] {
    return [...this.workflows.values()];
  }

  getWorkflow(id: string): WorkflowState | undefined {
    return this.workflows.get(id);
  }

  async startWorkflow(rawRequest: unknown): Promise<WorkflowState> {
    await this.ready();
    const request = WorkflowRequestSchema.parse(rawRequest);
    const now = new Date().toISOString();
    const workflow: WorkflowState = {
      id: crypto.randomUUID(),
      status: "running",
      stage: "research",
      draftAttempt: 0,
      request,
      verdicts: [],
      createdAt: now,
      updatedAt: now,
    };
    this.workflows.set(workflow.id, workflow);
    this.publish(workflow, "workflow.started", { request });
    this.startStage(workflow, "research", { request });
    return workflow;
  }

  stop() {
    this.socket.close();
  }

  private send(command: unknown) {
    this.socket.send(JSON.stringify(command));
  }

  private startStage(workflow: WorkflowState, stage: Stage, input: unknown) {
    workflow.stage = stage;
    workflow.status = "running";
    workflow.updatedAt = new Date().toISOString();

    if (stage === "drafting") {
      workflow.draftAttempt += 1;
      workflow.draftingSessionId ??= `draft-${workflow.id}`;
    } else if (stage === "critic") {
      workflow.criticSessionId ??= `critic-${workflow.id}`;
    }

    const command = StartRunCommandSchema.parse({
      type: "run.start",
      messageId: crypto.randomUUID(),
      workflowId: workflow.id,
      runId: crypto.randomUUID(),
      attempt: Math.max(workflow.draftAttempt, 1),
      sessionId:
        stage === "drafting"
          ? workflow.draftingSessionId
          : stage === "critic"
            ? workflow.criticSessionId
          : `${stage}-${workflow.id}-${crypto.randomUUID()}`,
      stage,
      input,
    });

    this.publish(workflow, "stage.dispatched", {
      stage,
      runId: command.runId,
      sessionId: command.sessionId,
      attempt: command.attempt,
    });
    this.send(command);
  }

  private sendFeedback(
    workflow: WorkflowState,
    sourceStage: "review" | "critic" | "deep_review",
    verdict: RevisionVerdict,
  ) {
    if (!workflow.draftingSessionId) {
      this.fail(workflow, "Workflow does not have a drafting session");
      return;
    }

    if (workflow.draftAttempt >= this.maxDraftAttempts) {
      workflow.status = "human_review";
      workflow.updatedAt = new Date().toISOString();
      this.publish(workflow, "workflow.human_review_required", {
        reason: "Maximum automatic revision attempts reached",
      });
      return;
    }

    workflow.status = "revising";
    workflow.stage = "drafting";
    workflow.draftAttempt += 1;
    workflow.updatedAt = new Date().toISOString();

    const command = FeedbackCommandSchema.parse({
      type: "run.feedback",
      messageId: crypto.randomUUID(),
      workflowId: workflow.id,
      runId: crypto.randomUUID(),
      attempt: workflow.draftAttempt,
      targetSessionId: workflow.draftingSessionId,
      feedback: { sourceStage, verdict },
    });

    this.publish(workflow, "feedback.routed", {
      from: sourceStage,
      to: "drafting",
      targetSessionId: command.targetSessionId,
      attempt: command.attempt,
      issues: verdict.issues,
    });
    this.send(command);
  }

  private async handleRunnerEvent(rawEvent: string) {
    let event;
    try {
      event = RunnerEventSchema.parse(JSON.parse(rawEvent));
    } catch {
      return;
    }

    const workflow = this.workflows.get(event.workflowId);
    if (!workflow || terminalStatuses.has(workflow.status)) return;

    if (event.type === "command.acknowledged") {
      this.publish(workflow, "command.acknowledged", {
        messageId: event.messageId,
        runId: event.runId,
      });
      return;
    }

    if (event.type === "run.started") {
      this.publish(workflow, "agent.started", event);
      return;
    }

    if (event.type === "agent.progress") {
      this.publish(workflow, "agent.progress", event);
      return;
    }

    if (event.type === "run.failed") {
      this.fail(workflow, event.error);
      return;
    }

    this.publish(workflow, "agent.completed", {
      stage: event.stage,
      runId: event.runId,
      sessionId: event.sessionId,
      attempt: event.attempt,
    });

    try {
      switch (event.stage) {
        case "research": {
          workflow.research = ResearchResultSchema.parse(event.result);
          this.startStage(workflow, "drafting", {
            request: workflow.request,
            research: workflow.research,
          });
          break;
        }

        case "drafting": {
          workflow.draft = DraftResultSchema.parse(event.result);
          this.publish(workflow, "draft.updated", workflow.draft);
          this.startEvaluation(workflow, "review");
          break;
        }

        case "review":
        case "critic":
        case "deep_review": {
          const verdict = VerdictSchema.parse(event.result);
          workflow.verdicts.push({
            stage: event.stage,
            attempt: workflow.draftAttempt,
            verdict,
          });
          this.publish(workflow, "verdict.received", {
            stage: event.stage,
            attempt: workflow.draftAttempt,
            verdict,
          });

          if (verdict.decision === "revise") {
            this.sendFeedback(workflow, event.stage, verdict);
          } else if (verdict.decision === "reject") {
            workflow.status = "rejected";
            workflow.updatedAt = new Date().toISOString();
            this.publish(workflow, "workflow.rejected", {
              stage: event.stage,
              reason: verdict.reason,
            });
          } else if (event.stage === "review") {
            this.startEvaluation(workflow, "critic");
          } else if (event.stage === "critic") {
            this.startEvaluation(workflow, "deep_review");
          } else {
            workflow.status = "approved";
            workflow.updatedAt = new Date().toISOString();
            this.publish(workflow, "workflow.approved", {
              draft: workflow.draft,
            });
          }
          break;
        }
      }
    } catch (error) {
      this.fail(workflow, error instanceof Error ? error.message : String(error));
    }
  }

  private startEvaluation(
    workflow: WorkflowState,
    stage: "review" | "critic" | "deep_review",
  ) {
    if (!workflow.research || !workflow.draft) {
      this.fail(workflow, `Cannot start ${stage} without research and a draft`);
      return;
    }

    this.startStage(workflow, stage, {
      request: workflow.request,
      research: workflow.research,
      draft: workflow.draft,
      priorVerdicts: workflow.verdicts,
    });
  }

  private fail(workflow: WorkflowState, error: string) {
    workflow.status = "failed";
    workflow.lastError = error;
    workflow.updatedAt = new Date().toISOString();
    this.publish(workflow, "workflow.failed", { error });
  }

  private publish(workflow: WorkflowState, type: string, data: unknown) {
    workflow.updatedAt = new Date().toISOString();
    this.events.publish(workflow.id, type, data);
  }
}

export type OrchestratorServer = {
  server: Bun.Server<undefined>;
  orchestrator: FactoryOrchestrator;
  url: string;
  stop: () => Promise<void>;
};

export async function startOrchestratorServer(args: {
  port?: number;
  runnerUrl: string;
  maxDraftAttempts?: number;
}): Promise<OrchestratorServer> {
  const orchestrator = new FactoryOrchestrator(
    args.runnerUrl,
    args.maxDraftAttempts,
  );
  await orchestrator.ready();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: args.port ?? 4100,
    async fetch(request, server) {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ status: "ok", service: "orchestrator" });
      }

      if (request.method === "GET" && url.pathname === "/workflows") {
        return Response.json(orchestrator.listWorkflows());
      }

      if (request.method === "POST" && url.pathname === "/workflows") {
        const body = await request.json().catch(() => null);
        const parsed = WorkflowRequestSchema.safeParse(body);

        if (!parsed.success) {
          return Response.json(
            { error: "Invalid workflow request", issues: parsed.error.issues },
            { status: 400 },
          );
        }

        const workflow = await orchestrator.startWorkflow(parsed.data);
        return Response.json(workflow, { status: 202 });
      }

      const eventMatch = url.pathname.match(/^\/workflows\/([^/]+)\/events$/);
      if (request.method === "GET" && eventMatch?.[1]) {
        const workflowId = eventMatch[1];
        if (!orchestrator.getWorkflow(workflowId)) {
          return Response.json({ error: "Workflow not found" }, { status: 404 });
        }

        server.timeout(request, 0);
        const encoder = new TextEncoder();
        let unsubscribe = () => {};
        let heartbeat: ReturnType<typeof setInterval> | undefined;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const event of orchestrator.events.eventsFor(workflowId)) {
              controller.enqueue(encoder.encode(formatSse(event)));
            }

            unsubscribe = orchestrator.events.subscribe(workflowId, (event) => {
              controller.enqueue(encoder.encode(formatSse(event)));
            });
            heartbeat = setInterval(() => {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            }, 15_000);
          },
          cancel() {
            unsubscribe();
            if (heartbeat) clearInterval(heartbeat);
          },
        });

        return new Response(stream, {
          headers: {
            "Cache-Control": "no-cache",
            "Content-Type": "text/event-stream",
          },
        });
      }

      const workflowMatch = url.pathname.match(/^\/workflows\/([^/]+)$/);
      if (request.method === "GET" && workflowMatch?.[1]) {
        const workflow = orchestrator.getWorkflow(workflowMatch[1]);
        return workflow
          ? Response.json(workflow)
          : Response.json({ error: "Workflow not found" }, { status: 404 });
      }

      return Response.json(
        {
          name: "Outbound Factory v0",
          endpoints: [
            "POST /workflows",
            "GET /workflows/:id",
            "GET /workflows/:id/events",
          ],
        },
        { status: url.pathname === "/" ? 200 : 404 },
      );
    },
  });

  return {
    server,
    orchestrator,
    url: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      orchestrator.stop();
      await server.stop(true);
    },
  };
}
