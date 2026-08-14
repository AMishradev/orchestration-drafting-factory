import {
  SendInputSchema,
  type DraftResult,
  type SendInput,
} from "./contracts";

export type FormattedOutbound = Pick<DraftResult, "subject" | "body"> & {
  message: string;
};

export function formatOutboundForSlack(rawInput: SendInput): FormattedOutbound {
  const input = SendInputSchema.parse(rawInput);
  const subject = cleanInline(input.draft.subject);
  const body = cleanBody(input.draft.body);
  const prospectName = [
    input.request.prospect.firstName,
    input.request.prospect.lastName,
  ]
    .filter(Boolean)
    .join(" ");
  const recipientLine = cleanInline(
    `${prospectName}, ${input.request.prospect.title} at ${input.request.company.name}`,
  );

  return {
    subject,
    body,
    message: [
      "## Outbound email",
      "",
      `**To:** ${recipientLine}`,
      `**Subject:** ${subject}`,
      "",
      "**Body:**",
      body,
    ].join("\n"),
  };
}

function cleanBody(value: string): string {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => (line.trim() ? cleanInline(line) : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanInline(value: string): string {
  return value
    .replace(/[\u2013\u2014;]/g, ",")
    .replace(/[ \t]*,[ \t]*/g, ", ")
    .replace(/,+/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}
