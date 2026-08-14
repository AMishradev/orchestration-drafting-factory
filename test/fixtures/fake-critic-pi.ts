import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
let critiqueCount = 0;
let lastText: string | null = null;

function emit(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

lines.on("line", (line) => {
  const command = JSON.parse(line) as {
    id: string;
    type: string;
    message?: string;
  };

  if (command.type === "prompt") {
    critiqueCount += 1;
    lastText = JSON.stringify(
      critiqueCount === 1
        ? {
            decision: "revise",
            issues: [
              {
                code: "CTA_TOO_VAGUE",
                message: "The call to action is too vague.",
                instruction: "Ask for a specific fifteen-minute conversation.",
                severity: "blocking",
              },
            ],
          }
        : {
            decision: "approve",
            notes: ["The revised email is concise and has a specific call to action."],
          },
    );

    emit({
      id: command.id,
      type: "response",
      command: "prompt",
      success: true,
    });
    emit({ type: "agent_start" });
    emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: critiqueCount === 1 ? "The call to action" : "Approved",
      },
    });
    emit({ type: "agent_settled" });
    return;
  }

  if (command.type === "get_last_assistant_text") {
    emit({
      id: command.id,
      type: "response",
      command: "get_last_assistant_text",
      success: true,
      data: { text: lastText },
    });
    return;
  }

  if (command.type === "abort") {
    emit({
      id: command.id,
      type: "response",
      command: "abort",
      success: true,
    });
  }
});
