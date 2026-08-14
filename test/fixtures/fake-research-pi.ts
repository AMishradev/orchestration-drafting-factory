import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
let promptCount = 0;
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
    promptCount += 1;
    lastText = JSON.stringify(
      [
        {
          action: "tool",
          purpose: "Find an internal identity",
          request: {
            tool: "slack_search",
            query: '"Renato Nitta" OR "CrewAI" OR "crewai.com"',
            limit: 20,
          },
        },
        {
          action: "tool",
          purpose: "Look up the discovered email",
          request: {
            tool: "posthog_people",
            email: "renato.nitta@crewai.com",
            offset: 0,
            limit: 50,
          },
        },
        {
          action: "tool",
          purpose: "Count company users",
          request: {
            tool: "posthog_hogql",
            query:
              "SELECT count() AS person_count FROM persons WHERE lower(toString(properties.email)) LIKE '%@crewai.com'",
          },
        },
        {
          action: "complete",
          companySummary:
            "Internal evidence includes Renato's CrewAI identity and a PostHog aggregate of 22 matching people.",
          selectedSignalIds: [
            "research-call-1-slack-1",
            "research-call-2-posthog-1",
            "research-call-3-posthog-1",
          ],
        },
      ][Math.min(promptCount - 1, 3)],
    );

    emit({
      id: command.id,
      type: "response",
      command: "prompt",
      success: true,
    });
    emit({ type: "agent_start" });
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
