import { z } from "zod";
import type { RunnerCommand, Stage } from "./contracts";

export const RemoteRunnerRoleSchema = z.enum([
  "research",
  "drafting",
  "critic",
  "send",
]);
export const RunnerRoleSchema = z.union([
  z.literal("all"),
  RemoteRunnerRoleSchema,
]);

export type RemoteRunnerRole = z.infer<typeof RemoteRunnerRoleSchema>;
export type RunnerRole = z.infer<typeof RunnerRoleSchema>;
export type RunnerEndpointMap = Record<RemoteRunnerRole, string>;

export function runnerRoleForStage(stage: Stage): RemoteRunnerRole {
  switch (stage) {
    case "research":
      return "research";
    case "drafting":
      return "drafting";
    case "review":
    case "critic":
    case "deep_review":
      return "critic";
    case "send":
      return "send";
  }
}

export function runnerCanHandle(
  role: RunnerRole,
  command: RunnerCommand,
): boolean {
  if (role === "all") return true;
  if (command.type === "run.feedback") return role === "drafting";
  return runnerRoleForStage(command.stage) === role;
}

export function endpointMapFromSingleUrl(url: string): RunnerEndpointMap {
  return {
    research: url,
    drafting: url,
    critic: url,
    send: url,
  };
}
