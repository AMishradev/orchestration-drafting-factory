import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  const command = JSON.parse(line) as { type: string };
  if (command.type !== "prompt") return;

  process.stderr.write(
    "[pi-exe-dev] missing pricing for 2 integration models; pi usage cost will be reported as zero\n",
  );
  process.stdout.write(
    `${JSON.stringify({
      type: "extension_ui_request",
      id: "setup-request",
      method: "select",
      title:
        "Use exe.dev LLM integrations?\nAutomatically configure pi before continuing.",
      options: [
        "Use exe.dev LLM integration [llm]",
        "I'll configure pi myself",
      ],
    })}\n`,
  );
});
