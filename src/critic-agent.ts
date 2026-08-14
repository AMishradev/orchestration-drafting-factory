import {
  EvaluationInputSchema,
  VerdictSchema,
  type EvaluationInput,
  type Verdict,
} from "./contracts";
import { MockAgentEngine } from "./mock-agent";

export type CriticProgressHandler = (event: unknown) => void;

export type CriticArgs = {
  sessionId: string;
  input: EvaluationInput;
  attempt: number;
  onProgress?: CriticProgressHandler;
};

export interface CriticAgent {
  readonly kind: "mock" | "pi-rpc";
  critique(args: CriticArgs): Promise<Verdict>;
  abort(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  disposeAll(): Promise<void>;
}

export class MockCriticAgent implements CriticAgent {
  readonly kind = "mock" as const;

  constructor(private readonly engine: MockAgentEngine) {}

  async critique(args: CriticArgs): Promise<Verdict> {
    const input = EvaluationInputSchema.parse(args.input);
    const verdict = VerdictSchema.parse(await this.engine.run("critic", input));
    return enforceCriticPolicy(input, verdict);
  }

  async abort(_sessionId: string): Promise<void> {}
  async dispose(_sessionId: string): Promise<void> {}
  async disposeAll(): Promise<void> {}
}

const forbiddenFairPattern = /\bfair\b/i;
const allowedCampaignToneIssue = "TONE_UNPROFESSIONAL";
const futureDateContext =
  /\b(?:upcoming|scheduled|booked|set\s+to|set\s+for|will|shall|convene|appointment|before|ahead\s+of|look(?:ing)?\s+forward|meet(?:ing)?\s+on|calendar|appointed\s+hour|ere\s+we\s+meet)\b/i;
const pastDateContext =
  /\b(?:met|spoke|talked|discussed|launched|happened|occurred|was|were|previous|previously|last|earlier|after|since|following)\b/i;

type DateReference = {
  text: string;
  index: number;
  year?: number;
  month: number;
  day: number;
};

export function enforceCriticPolicy(
  input: EvaluationInput,
  verdict: Verdict,
  now = new Date(),
): Verdict {
  const campaignVerdict = allowIntentionalCampaignTone(verdict);
  const draftText = `${input.draft.subject}\n${input.draft.body}`;
  const policyIssues: Array<{
    code: string;
    message: string;
    instruction: string;
    severity: "blocking";
  }> = [];

  if (forbiddenFairPattern.test(draftText)) {
    policyIssues.push({
      code: "FORBIDDEN_WORD_FAIR",
      message: 'The critic does not allow the word "fair" in the email.',
      instruction: 'Remove or rewrite every occurrence of the word "fair".',
      severity: "blocking",
    });
  }

  const staleDates = findStaleUpcomingDates(draftText, now);
  if (staleDates.length > 0) {
    policyIssues.push({
      code: "STALE_DATE_REFERENCE",
      message: `The email presents an already-passed date as upcoming: ${staleDates
        .map((date) => `"${date}"`)
        .join(", ")}.`,
      instruction:
        "Remove the stale date or replace it only with a current, verified next step. Do not invent a new meeting date.",
      severity: "blocking",
    });
  }

  if (policyIssues.length === 0) return campaignVerdict;

  const policyCodes = new Set(policyIssues.map(({ code }) => code));

  return VerdictSchema.parse({
    decision: "revise",
    issues:
      campaignVerdict.decision === "revise"
        ? [
            ...campaignVerdict.issues.filter(
              ({ code }) => !policyCodes.has(code),
            ),
            ...policyIssues,
          ]
        : policyIssues,
  });
}

export function findStaleUpcomingDates(
  text: string,
  now = new Date(),
): string[] {
  const references = [
    ...findMonthFirstDates(text),
    ...findDayFirstDates(text),
  ];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const stale = new Set<string>();

  for (const reference of references) {
    const year = reference.year ?? today.getFullYear();
    const date = new Date(year, reference.month, reference.day);
    const isValid =
      date.getFullYear() === year &&
      date.getMonth() === reference.month &&
      date.getDate() === reference.day;
    if (!isValid || date >= today) continue;

    const context = text.slice(
      Math.max(0, reference.index - 120),
      Math.min(text.length, reference.index + reference.text.length + 120),
    );
    if (futureDateContext.test(context)) {
      stale.add(reference.text.trim());
      continue;
    }
    if (!pastDateContext.test(context)) stale.add(reference.text.trim());
  }

  return [...stale];
}

function findMonthFirstDates(text: string): DateReference[] {
  const pattern = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?:\\s+(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)(?:\\s+[A-Z]{2,5})?)?`,
    "gi",
  );
  return [...text.matchAll(pattern)].flatMap((match) => {
    const month = monthIndex(match[1]);
    const day = Number(match[2]);
    if (month === undefined || !match[0] || match.index === undefined) return [];
    return [{
      text: match[0],
      index: match.index,
      year: match[3] ? Number(match[3]) : undefined,
      month,
      day,
    }];
  });
}

function findDayFirstDates(text: string): DateReference[] {
  const pattern = new RegExp(
    `\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+day)?\\s+of\\s+(${monthPattern})(?:,?\\s+(\\d{4}))?`,
    "gi",
  );
  return [...text.matchAll(pattern)].flatMap((match) => {
    const month = monthIndex(match[2]);
    const day = Number(match[1]);
    if (month === undefined || !match[0] || match.index === undefined) return [];
    return [{
      text: match[0],
      index: match.index,
      year: match[3] ? Number(match[3]) : undefined,
      month,
      day,
    }];
  });
}

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;
const monthPattern =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

function monthIndex(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/\.$/, "");
  const index = monthNames.findIndex((name) =>
    name.startsWith(normalized.slice(0, 3)),
  );
  return index >= 0 ? index : undefined;
}

function allowIntentionalCampaignTone(verdict: Verdict): Verdict {
  if (verdict.decision !== "revise") return verdict;

  const remainingIssues = verdict.issues.filter(
    ({ code }) => code.toUpperCase() !== allowedCampaignToneIssue,
  );
  if (remainingIssues.length > 0) {
    return VerdictSchema.parse({ decision: "revise", issues: remainingIssues });
  }

  return VerdictSchema.parse({
    decision: "approve",
    notes: ["The intentional medieval campaign tone is allowed."],
  });
}
