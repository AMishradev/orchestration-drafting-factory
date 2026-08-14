import {
  DraftResultSchema,
  DraftingInputSchema,
  EvaluationInputSchema,
  ResearchInputSchema,
  RunnerCommandSchema,
  RunnerEventSchema,
  type FeedbackCommand,
  type RunnerEvent,
  type Stage,
} from "./contracts";
import {
  MockCriticAgent,
  type CriticAgent,
} from "./critic-agent";
import {
  MockDraftingAgent,
  type DraftingAgent,
} from "./drafting-agent";
import { MockAgentEngine } from "./mock-agent";
import { PiRpcDraftingAgent } from "./pi-drafting-agent";
import { PiRpcCriticAgent } from "./pi-critic-agent";
import { ComposioResearchAgent } from "./composio-research-agent";
import {
  MockResearchAgent,
  type ResearchAgent,
} from "./research-agent";

type RunnerSocketData = { connectedAt: string };

type StoredSession = {
  sessionId: string;
  workflowId: string;
  stage: Stage;
  input: unknown;
  output?: unknown;
};

export type RunnerServer = {
  server: Bun.Server<RunnerSocketData>;
  url: string;
  researchEngine: ResearchAgent["kind"];
  draftingEngine: DraftingAgent["kind"];
  criticEngine: CriticAgent["kind"];
  stop: () => Promise<void>;
};

export type RunnerOptions = {
  researchAgent?: ResearchAgent;
  draftingAgent?: DraftingAgent;
  criticAgent?: CriticAgent;
};

export function startRunnerServer(
  port = 4101,
  options: RunnerOptions = {},
): RunnerServer {
  const engine = new MockAgentEngine();
  const researchAgent =
    options.researchAgent ??
    (Bun.env.RESEARCH_ENGINE === "composio"
      ? new ComposioResearchAgent()
      : new MockResearchAgent(engine));
  const draftingAgent =
    options.draftingAgent ??
    (Bun.env.DRAFTING_ENGINE === "pi"
      ? new PiRpcDraftingAgent()
      : new MockDraftingAgent(engine));
  const criticAgent =
    options.criticAgent ??
    (Bun.env.CRITIC_ENGINE === "pi"
      ? new PiRpcCriticAgent()
      : new MockCriticAgent(engine));
  const sessions = new Map<string, StoredSession>();

  const server = Bun.serve<RunnerSocketData>({
    hostname: "127.0.0.1",
    port,
    fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          service: "runner",
          researchEngine: researchAgent.kind,
          draftingEngine: draftingAgent.kind,
          criticEngine: criticAgent.kind,
        });
      }

      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(request, {
          data: { connectedAt: new Date().toISOString() },
        });
        if (upgraded) return;
      }

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      message(socket, rawMessage) {
        void handleCommand(socket, String(rawMessage));
      },
    },
  });

  function send(socket: Bun.ServerWebSocket<RunnerSocketData>, event: RunnerEvent) {
    socket.send(JSON.stringify(RunnerEventSchema.parse(event)));
  }

  async function handleCommand(
    socket: Bun.ServerWebSocket<RunnerSocketData>,
    rawMessage: string,
  ) {
    const parsed = RunnerCommandSchema.safeParse(JSON.parse(rawMessage));
    if (!parsed.success) {
      socket.send(
        JSON.stringify({
          type: "protocol.error",
          error: parsed.error.message,
        }),
      );
      return;
    }

    const command = parsed.data;
    send(socket, {
      type: "command.acknowledged",
      messageId: command.messageId,
      workflowId: command.workflowId,
      runId: command.runId,
    });

    if (command.type === "run.feedback") {
      await applyFeedback(socket, command);
      return;
    }

    const session: StoredSession = {
      sessionId: command.sessionId,
      workflowId: command.workflowId,
      stage: command.stage,
      input: command.input,
    };
    sessions.set(command.sessionId, session);

    send(socket, {
      type: "run.started",
      workflowId: command.workflowId,
      runId: command.runId,
      sessionId: command.sessionId,
      stage: command.stage,
      attempt: command.attempt,
    });

    try {
      const onProgress = (event: unknown) =>
        send(socket, {
          type: "agent.progress",
          workflowId: command.workflowId,
          runId: command.runId,
          sessionId: command.sessionId,
          stage: command.stage,
          attempt: command.attempt,
          event,
        });
      const result =
        command.stage === "research"
          ? await researchAgent.research({
              sessionId: command.sessionId,
              input: ResearchInputSchema.parse(command.input),
              attempt: command.attempt,
              onProgress,
            })
          : command.stage === "drafting"
          ? await draftingAgent.draft({
              sessionId: command.sessionId,
              input: DraftingInputSchema.parse(command.input),
              attempt: command.attempt,
              onProgress,
            })
          : command.stage === "critic"
            ? await criticAgent.critique({
                sessionId: command.sessionId,
                input: EvaluationInputSchema.parse(command.input),
                attempt: command.attempt,
                onProgress,
              })
            : await engine.run(command.stage, command.input);
      session.output = result;
      send(socket, {
        type: "run.completed",
        workflowId: command.workflowId,
        runId: command.runId,
        sessionId: command.sessionId,
        stage: command.stage,
        attempt: command.attempt,
        result,
      });
    } catch (error) {
      send(socket, {
        type: "run.failed",
        workflowId: command.workflowId,
        runId: command.runId,
        sessionId: command.sessionId,
        stage: command.stage,
        attempt: command.attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function applyFeedback(
    socket: Bun.ServerWebSocket<RunnerSocketData>,
    command: FeedbackCommand,
  ) {
    const session = sessions.get(command.targetSessionId);

    if (!session || session.stage !== "drafting" || !session.output) {
      send(socket, {
        type: "run.failed",
        workflowId: command.workflowId,
        runId: command.runId,
        sessionId: command.targetSessionId,
        stage: "drafting",
        attempt: command.attempt,
        error: "Drafting session is unavailable for feedback",
      });
      return;
    }

    send(socket, {
      type: "run.started",
      workflowId: command.workflowId,
      runId: command.runId,
      sessionId: command.targetSessionId,
      stage: "drafting",
      attempt: command.attempt,
    });

    try {
      const result = await draftingAgent.revise({
        sessionId: command.targetSessionId,
        input: DraftingInputSchema.parse(session.input),
        attempt: command.attempt,
        previousDraft: DraftResultSchema.parse(session.output),
        feedback: command.feedback.verdict,
        onProgress: (event) =>
          send(socket, {
            type: "agent.progress",
            workflowId: command.workflowId,
            runId: command.runId,
            sessionId: command.targetSessionId,
            stage: "drafting",
            attempt: command.attempt,
            event,
          }),
      });
      session.output = result;

      send(socket, {
        type: "run.completed",
        workflowId: command.workflowId,
        runId: command.runId,
        sessionId: command.targetSessionId,
        stage: "drafting",
        attempt: command.attempt,
        result,
      });
    } catch (error) {
      send(socket, {
        type: "run.failed",
        workflowId: command.workflowId,
        runId: command.runId,
        sessionId: command.targetSessionId,
        stage: "drafting",
        attempt: command.attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    server,
    url: `ws://127.0.0.1:${server.port}/ws`,
    researchEngine: researchAgent.kind,
    draftingEngine: draftingAgent.kind,
    criticEngine: criticAgent.kind,
    stop: async () => {
      await Promise.all([
        researchAgent.disposeAll(),
        draftingAgent.disposeAll(),
        criticAgent.disposeAll(),
      ]);
      await server.stop(true);
    },
  };
}
