import {
  DraftResultSchema,
  RunnerCommandSchema,
  RunnerEventSchema,
  type DraftResult,
  type FeedbackCommand,
  type RunnerEvent,
  type Stage,
} from "./contracts";
import { MockAgentEngine } from "./mock-agent";

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
  stop: () => Promise<void>;
};

export function startRunnerServer(port = 4101): RunnerServer {
  const engine = new MockAgentEngine();
  const sessions = new Map<string, StoredSession>();

  const server = Bun.serve<RunnerSocketData>({
    hostname: "127.0.0.1",
    port,
    fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return Response.json({ status: "ok", service: "runner" });
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
      const result = await engine.run(command.stage, command.input);
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
      const result = await engine.reviseDraft({
        input: session.input as Parameters<MockAgentEngine["reviseDraft"]>[0]["input"],
        previousDraft: DraftResultSchema.parse(session.output) as DraftResult,
        feedback: command.feedback.verdict,
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
    stop: () => server.stop(true),
  };
}
