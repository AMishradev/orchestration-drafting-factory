import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
let revision = 0;
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
    revision += 1;
    lastText = JSON.stringify({
      revision,
      subject: revision === 1 ? "A knightly missive" : "A revised knightly missive",
      body:
        revision === 1
          ? "Hark Maya! Thy enterprise launch and 200 sales reps hath reached mine ears. Shall we compare scrolls?"
          : "Hark Maya! Thy enterprise launch hath reached mine ears. I have removed the disputed claim; shall we compare scrolls?",
      evidenceSignalIds: ["signal-enterprise-launch"],
    });

    emit({
      id: command.id,
      type: "response",
      command: "prompt",
      success: true,
    });
    emit({ type: "agent_start" });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hark!" } });
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
