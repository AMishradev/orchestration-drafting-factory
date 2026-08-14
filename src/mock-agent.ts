import {
  DraftResultSchema,
  ResearchResultSchema,
  VerdictSchema,
  type DraftResult,
  type ResearchResult,
  type RevisionVerdict,
  type Stage,
  type Verdict,
  type WorkflowRequest,
} from "./contracts";

type ResearchInput = { request: WorkflowRequest };
type DraftInput = {
  request: WorkflowRequest;
  research: ResearchResult;
};
type EvaluationInput = DraftInput & { draft: DraftResult };

const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class MockAgentEngine {
  async run(stage: Stage, input: unknown): Promise<unknown> {
    await pause(35);

    switch (stage) {
      case "research":
        return this.research(input as ResearchInput);
      case "drafting":
        return this.draft(input as DraftInput);
      case "review":
        return this.review(input as EvaluationInput);
      case "critic":
        return this.critic(input as EvaluationInput);
      case "deep_review":
        return this.deepReview(input as EvaluationInput);
    }
  }

  async reviseDraft(args: {
    input: DraftInput;
    previousDraft: DraftResult;
    feedback: RevisionVerdict;
  }): Promise<DraftResult> {
    await pause(35);

    const { request, research } = args.input;
    const mainSignal = research.signals[0];
    if (!mainSignal) throw new Error("Research did not include a usable signal");

    return DraftResultSchema.parse({
      revision: args.previousDraft.revision + 1,
      subject: `${request.company.name}'s enterprise launch`,
      body: [
        `Hi ${request.prospect.firstName},`,
        "",
        `I noticed ${mainSignal.claim.toLowerCase()}.`,
        `We help ${request.prospect.title.toLowerCase()} leaders turn signals like that into focused outbound without relying on unsupported personalization.`,
        "",
        "Worth comparing notes?",
      ].join("\n"),
      evidenceSignalIds: [mainSignal.id],
    });
  }

  private research({ request }: ResearchInput): ResearchResult {
    return ResearchResultSchema.parse({
      companySummary: `${request.company.name} is expanding its enterprise go-to-market motion.`,
      signals: [
        {
          id: "signal-enterprise-launch",
          claim: `${request.company.name} launched a new enterprise offering`,
          sourceUrl: `https://${request.company.domain}/news/enterprise`,
          confidence: 0.94,
        },
      ],
    });
  }

  private draft({ request, research }: DraftInput): DraftResult {
    const mainSignal = research.signals[0];
    if (!mainSignal) throw new Error("Research did not include a usable signal");

    // The unsupported hiring claim is deliberate: it proves that feedback is
    // routed back into the same drafting session during the demo.
    return DraftResultSchema.parse({
      revision: 1,
      subject: `Quick idea for ${request.company.name}`,
      body: [
        `Hi ${request.prospect.firstName},`,
        "",
        `I noticed ${mainSignal.claim.toLowerCase()} and that you're hiring 200 sales reps this quarter.`,
        "We help teams automate outbound research and drafting.",
        "",
        "Open to a quick chat?",
      ].join("\n"),
      evidenceSignalIds: [mainSignal.id],
    });
  }

  private review({ draft }: EvaluationInput): Verdict {
    if (draft.body.includes("200 sales reps")) {
      return VerdictSchema.parse({
        decision: "revise",
        issues: [
          {
            code: "UNSUPPORTED_CLAIM",
            message: "The claim about hiring 200 sales reps has no supporting research signal.",
            instruction: "Remove the hiring claim and use only the sourced enterprise-launch signal.",
            severity: "blocking",
          },
        ],
      });
    }

    return VerdictSchema.parse({
      decision: "approve",
      notes: ["Every personalized claim maps to a research signal."],
    });
  }

  private critic({ draft }: EvaluationInput): Verdict {
    if (draft.body.length > 700) {
      return VerdictSchema.parse({
        decision: "revise",
        issues: [
          {
            code: "TOO_LONG",
            message: "The email is too long for first-touch outbound.",
            instruction: "Shorten the body to under 700 characters.",
            severity: "blocking",
          },
        ],
      });
    }

    return VerdictSchema.parse({
      decision: "approve",
      notes: ["The revised email is concise and specific."],
    });
  }

  private deepReview({ draft, research }: EvaluationInput): Verdict {
    const evidenceIsValid = draft.evidenceSignalIds.every((id) =>
      research.signals.some((signal) => signal.id === id),
    );

    if (!evidenceIsValid) {
      return VerdictSchema.parse({
        decision: "reject",
        reason: "The draft references evidence that is missing from the research artifact.",
      });
    }

    return VerdictSchema.parse({
      decision: "approve",
      notes: ["Final evidence and quality checks passed."],
    });
  }
}
