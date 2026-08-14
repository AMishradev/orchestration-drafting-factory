export type PiAgentRole = "research" | "drafting" | "critic";

export function defaultPiCommand(role: PiAgentRole, sessionId: string): string[] {
  const rolePrefix = role.toUpperCase();
  const command = [
    Bun.env[`PI_${rolePrefix}_COMMAND`] ?? Bun.env.PI_COMMAND ?? "pi",
    "--mode",
    "rpc",
    "--no-session",
    "--no-tools",
    "--name",
    `${role}-${sessionId}`,
  ];

  const provider =
    Bun.env[`PI_${rolePrefix}_PROVIDER`] ?? Bun.env.PI_PROVIDER;
  const model = Bun.env[`PI_${rolePrefix}_MODEL`] ?? Bun.env.PI_MODEL;
  const thinking =
    Bun.env[`PI_${rolePrefix}_THINKING`] ?? Bun.env.PI_THINKING;

  if (provider) command.push("--provider", provider);
  if (model) command.push("--model", model);
  if (thinking) command.push("--thinking", thinking);
  return command;
}
