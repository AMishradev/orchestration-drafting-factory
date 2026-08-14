import {
  SignalSchema,
  type Signal,
  type WorkflowRequest,
} from "./contracts";
import type {
  ComposioResearchConfig,
  InternalResearchSource,
  ResearchSourcePlan,
} from "./composio-research-source";

const toolVersions = {
  slack: "20260721_00",
  granola: "20260805_00",
  fireflies: "20260625_00",
  salesforce: "20260804_00",
  posthog: "20260707_00",
  metabase: "20260615_00",
} as const;

type ExtractedRecord = { claim: string; sourceUrl?: string };

export function buildResearchSourcePlans(
  request: WorkflowRequest,
  config: ComposioResearchConfig,
): ResearchSourcePlan[] {
  const fullName = [request.prospect.firstName, request.prospect.lastName]
    .filter(Boolean)
    .join(" ");
  const identifiers = [
    request.prospect.email,
    fullName,
    request.company.name,
    request.company.domain,
  ].filter((value): value is string => Boolean(value));
  const strongestIdentifier =
    request.prospect.email ?? request.company.domain ?? request.company.name;
  const granolaIdentifiers = [
    request.prospect.email,
    fullName,
    request.prospect.firstName,
    request.company.name,
    request.company.domain,
  ].filter((value): value is string => Boolean(value));

  return [
    plan(
      "slack",
      "SLACK_SEARCH_MESSAGES",
      toolVersions.slack,
      {
        query: identifiers.map((value) => `"${escapeSlack(value)}"`).join(" OR "),
        count: 20,
        sort: "timestamp",
        sort_dir: "desc",
        highlight: false,
        auto_paginate: false,
      },
      extractSlack,
    ),
    plan(
      "granola",
      "GRANOLA_MCP_QUERY_GRANOLA_MEETINGS",
      toolVersions.granola,
      {
        query: [
          "Search all internal Granola meeting notes and recordings.",
          `Match ANY one of these identifiers independently (OR semantics): ${[
            ...new Set(granolaIdentifiers),
          ].map((value) => JSON.stringify(value)).join(", ")}.`,
          "A meeting is relevant when any identifier matches, even if its participant email or company domain differs from the workflow input.",
          "Return only relevant meeting facts, dates, participants, decisions, pains, and next steps.",
        ]
          .join(" "),
      },
      extractGranola,
    ),
    plan(
      "fireflies",
      "FIREFLIES_GET_TRANSCRIPTS",
      toolVersions.fireflies,
      request.prospect.email
        ? {
            participants: [request.prospect.email],
            limit: 20,
            include_summary: true,
            include_meeting_attendees: true,
          }
        : {
            title: request.company.name,
            limit: 20,
            include_summary: true,
            include_meeting_attendees: true,
          },
      extractFireflies,
    ),
    plan(
      "salesforce",
      "SALESFORCE_EXECUTE_SOSL_SEARCH",
      toolVersions.salesforce,
      {
        q: [
          `FIND {${escapeSosl(strongestIdentifier)}} IN ALL FIELDS`,
          "RETURNING",
          "Account(Id, Name, Website, Description)",
          "Contact(Id, FirstName, LastName, Email, Title, AccountId)",
          "Lead(Id, FirstName, LastName, Email, Title, Company)",
          "LIMIT 20",
        ].join(" "),
      },
      extractSalesforce,
    ),
    config.posthogProjectId
      ? plan(
          "posthog",
          "POSTHOG_LIST_OR_DELETE_PERSONS_WITH_OPTIONAL_FILTERS",
          toolVersions.posthog,
          {
            project_id: config.posthogProjectId,
            ...(request.prospect.email
              ? { email: request.prospect.email }
              : { search: strongestIdentifier }),
            limit: 20,
            format: "json",
          },
          extractPosthog,
        )
      : unavailablePlan(
          "posthog",
          "POSTHOG_LIST_OR_DELETE_PERSONS_WITH_OPTIONAL_FILTERS",
          "Set COMPOSIO_POSTHOG_PROJECT_ID to enable PostHog research",
        ),
    config.metabaseCardId
      ? plan(
          "metabase",
          "METABASE_CREATE_CARD_QUERY1",
          toolVersions.metabase,
          {
            card_id: config.metabaseCardId,
            parameters: [
              templateTag(
                config.metabasePersonTag,
                request.prospect.email ?? fullName,
              ),
              templateTag(
                config.metabaseCompanyTag,
                request.company.domain || request.company.name,
              ),
            ],
            ignore_cache: false,
          },
          (result) => extractMetabase(result, config.metabaseCardId!),
        )
      : unavailablePlan(
          "metabase",
          "METABASE_CREATE_CARD_QUERY1",
          "Set COMPOSIO_METABASE_CARD_ID to enable Metabase research",
        ),
  ];
}

function plan(
  source: InternalResearchSource,
  toolSlug: string,
  version: string,
  args: Record<string, unknown>,
  extractor: (result: unknown) => ExtractedRecord[],
): ResearchSourcePlan {
  return {
    source,
    toolSlug,
    call: { source, toolSlug, version, arguments: args },
    extractSignals: (result) =>
      extractor(result)
        .slice(0, 5)
        .map((record, index) =>
          SignalSchema.parse({
            id: `internal-${source}-${index + 1}`,
            claim: normalizeText(record.claim, 600),
            sourceUrl:
              record.sourceUrl ?? `composio://${source}/${toolSlug}`,
            confidence: sourceConfidence(source),
            source,
          }),
        ),
  };
}

function unavailablePlan(
  source: InternalResearchSource,
  toolSlug: string,
  unavailableReason: string,
): ResearchSourcePlan {
  return {
    source,
    toolSlug,
    unavailableReason,
    extractSignals: () => [],
  };
}

function extractSlack(result: unknown): ExtractedRecord[] {
  return findArrayByKey(result, "matches").map((item) => {
    const record = asRecord(item);
    const channel = asRecord(record.channel);
    const author = firstString(record, ["username", "user_name", "display_name"]);
    const text = firstString(record, ["text", "content", "message"]);
    return {
      claim: [
        "Slack",
        channel.name ? `#${String(channel.name)}` : undefined,
        author ? `from ${author}` : undefined,
        text,
      ]
        .filter(Boolean)
        .join(" — "),
      sourceUrl: firstString(record, ["permalink", "url"]),
    };
  }).filter(({ claim }) => Boolean(claim));
}

function extractGranola(result: unknown): ExtractedRecord[] {
  const texts = [
    ...(typeof result === "string" ? [result] : []),
    ...["data", "text", "content", "output", "result"].flatMap((key) =>
      findStringsByKey(result, key),
    ),
  ];

  return [...new Set(texts.filter((text) => text.trim().length > 0))]
    .flatMap((text) => chunkText(text, 540))
    .map((text) => ({ claim: `Granola meeting context — ${text}` }));
}

function extractFireflies(result: unknown): ExtractedRecord[] {
  return findArrayByKey(result, "transcripts").map((item) => {
    const record = asRecord(item);
    const summary = asRecord(record.summary);
    const details = [
      firstString(record, ["title", "meeting_title"]),
      firstString(record, ["date", "dateString"]),
      firstString(summary, ["overview", "short_summary", "notes", "action_items"]),
    ].filter(Boolean);
    return {
      claim: `Fireflies meeting — ${details.join(" — ")}`,
      sourceUrl: firstString(record, ["transcript_url", "meeting_link", "url"]),
    };
  }).filter(({ claim }) => claim !== "Fireflies meeting — ");
}

function extractSalesforce(result: unknown): ExtractedRecord[] {
  return findArrayByKey(result, "searchRecords").map((item) => {
    const record = asRecord(item);
    const attributes = asRecord(record.attributes);
    const values = compactRecord(record, [
      "Name",
      "FirstName",
      "LastName",
      "Email",
      "Title",
      "Company",
      "Website",
      "Description",
      "AccountId",
    ]);
    return {
      claim: `Salesforce ${String(attributes.type ?? "record")} — ${JSON.stringify(values)}`,
      sourceUrl: attributes.url
        ? `salesforce://${String(attributes.url)}`
        : undefined,
    };
  });
}

function extractPosthog(result: unknown): ExtractedRecord[] {
  return findArrayByKey(result, "results").map((item) => {
    const record = asRecord(item);
    const properties = asRecord(record.properties);
    const values = {
      id: record.id,
      distinctIds: record.distinct_ids,
      ...compactRecord(properties, [
        "email",
        "$email",
        "name",
        "$name",
        "company",
        "company_name",
        "plan",
      ]),
    };
    return {
      claim: `PostHog person — ${JSON.stringify(values)}`,
      sourceUrl: record.id
        ? `posthog://person/${String(record.id)}`
        : undefined,
    };
  });
}

function extractMetabase(result: unknown, cardId: number): ExtractedRecord[] {
  const rows = findArrayByKey(result, "rows");
  const columns = findArrayByKey(result, "cols").map((column, index) => {
    const record = asRecord(column);
    return String(record.display_name ?? record.name ?? `column_${index + 1}`);
  });

  return rows.slice(0, 5).map((row) => {
    const values = Array.isArray(row) ? row : [row];
    const mapped = Object.fromEntries(
      values.map((value, index) => [columns[index] ?? `column_${index + 1}`, value]),
    );
    return {
      claim: `Metabase saved-card result — ${JSON.stringify(mapped)}`,
      sourceUrl: `metabase://card/${cardId}`,
    };
  });
}

function templateTag(name: string, value: string) {
  return {
    type: "category",
    value,
    target: ["variable", ["template-tag", name]],
  };
}

function escapeSlack(value: string): string {
  return value.replace(/["\\]/g, " ").trim();
}

function escapeSosl(value: string): string {
  return value.replace(/[{}?&|!(){}\[\]^~*:\"'+\\-]/g, " ").trim();
}

function sourceConfidence(source: InternalResearchSource): number {
  return {
    slack: 0.82,
    granola: 0.86,
    fireflies: 0.86,
    salesforce: 0.9,
    posthog: 0.88,
    metabase: 0.84,
  }[source];
}

function normalizeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
}

function chunkText(value: string, maxLength: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if (current && current.length + word.length + 1 > maxLength) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current} ${word}` : word;
  }

  if (current) chunks.push(current);
  return chunks;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function findArrayByKey(
  value: unknown,
  key: string,
  depth = 0,
): unknown[] {
  if (depth > 6 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArrayByKey(item, key, depth + 1);
      if (found.length > 0) return found;
    }
    return [];
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record[key])) return record[key] as unknown[];
  for (const nested of Object.values(record)) {
    const found = findArrayByKey(nested, key, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

function findStringsByKey(
  value: unknown,
  key: string,
  depth = 0,
): string[] {
  if (depth > 6 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => findStringsByKey(item, key, depth + 1));
  }
  const record = value as Record<string, unknown>;
  const own = typeof record[key] === "string" ? [record[key] as string] : [];
  return [
    ...own,
    ...Object.values(record).flatMap((nested) =>
      findStringsByKey(nested, key, depth + 1),
    ),
  ];
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function compactRecord(
  record: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => record[key] !== undefined && record[key] !== null)
      .map((key) => [key, record[key]]),
  );
}
