import {
  ResearchToolObservationSchema,
  ResearchToolRequestSchema,
  type DiscoveredIdentity,
  type ResearchToolName,
  type ResearchToolObservation,
  type ResearchToolRequest,
} from "./agentic-research-contracts";
import type {
  ComposioResearchConfig,
  ComposioResearchToolCall,
  InternalResearchSource,
  ResearchToolExecutor,
} from "./composio-research-source";
import {
  extractFireflies,
  extractGranola,
  extractPosthog,
  extractPosthogHogql,
  extractSalesforce,
  extractSlack,
  signalsFromExtractedRecords,
  type ExtractedRecord,
} from "./research-source-adapters";

const toolDefinitions = {
  slack_search: {
    source: "slack",
    toolSlug: "SLACK_SEARCH_MESSAGES",
    version: "20260721_00",
  },
  granola_search: {
    source: "granola",
    toolSlug: "GRANOLA_MCP_QUERY_GRANOLA_MEETINGS",
    version: "20260805_00",
  },
  fireflies_search: {
    source: "fireflies",
    toolSlug: "FIREFLIES_GET_TRANSCRIPTS",
    version: "20260625_00",
  },
  salesforce_search: {
    source: "salesforce",
    toolSlug: "SALESFORCE_EXECUTE_SOSL_SEARCH",
    version: "20260804_00",
  },
  posthog_people: {
    source: "posthog",
    toolSlug: "POSTHOG_LIST_OR_DELETE_PERSONS_WITH_OPTIONAL_FILTERS",
    version: "20260707_00",
  },
  posthog_hogql: {
    source: "posthog",
    toolSlug: "POSTHOG_CREATE_QUERY_IN_PROJECT_BY_ID",
    version: "20260707_00",
  },
} as const satisfies Record<
  ResearchToolName,
  {
    source: InternalResearchSource;
    toolSlug: string;
    version: string;
  }
>;

export class AgenticResearchToolBroker {
  constructor(
    private readonly config: ComposioResearchConfig,
    private readonly executor: ResearchToolExecutor,
  ) {}

  availableTools(): ResearchToolName[] {
    const names = Object.keys(toolDefinitions) as ResearchToolName[];
    return this.config.posthogProjectId
      ? names
      : names.filter((name) => !name.startsWith("posthog_"));
  }

  toolGuide(): string {
    return [
      "slack_search: {query, limit}; search internal Slack messages.",
      "granola_search: {query}; search Granola meeting notes with a precise natural-language query.",
      "fireflies_search: {email or title, limit}; find Fireflies transcripts.",
      "salesforce_search: {query}; search Account, Contact, and Lead fields. The broker safely constructs SOSL.",
      "posthog_people: {email or search or propertyFilters, offset, limit}; find individual people. Prefer an exact discovered email over a company-domain search.",
      "posthog_hogql: {query}; run one read-only SELECT/WITH HogQL query for aggregate questions such as the number of people at a company.",
    ]
      .filter((line) =>
        this.availableTools().some((tool) => line.startsWith(`${tool}:`)),
      )
      .join("\n");
  }

  async execute(
    input: ResearchToolRequest,
    callIndex: number,
    signal: AbortSignal,
  ): Promise<ResearchToolObservation> {
    const request = ResearchToolRequestSchema.parse(input);
    if (!this.availableTools().includes(request.tool)) {
      throw new Error(`${request.tool} is not configured for this research run`);
    }

    const definition = toolDefinitions[request.tool];
    const callId = `research-call-${callIndex}`;
    const call = this.buildCall(request, definition);
    const result = await this.executor.execute(call, signal);
    const records = this.extract(request.tool, result);
    const signals = signalsFromExtractedRecords({
      source: definition.source,
      toolSlug: definition.toolSlug,
      records,
      idPrefix: `${callId}-${definition.source}`,
      maxSignals: 10,
    });
    const identities = extractIdentities(records, definition.source);
    const resultCount = records.length;
    const next = findFirstValue(result, "next");
    const hasMore = typeof next === "string" && next.length > 0;
    const nextOffset = hasMore
      ? request.tool === "posthog_people"
        ? request.offset + request.limit
        : undefined
      : undefined;

    return ResearchToolObservationSchema.parse({
      callId,
      source: definition.source,
      tool: request.tool,
      request,
      resultCount,
      hasMore,
      nextOffset,
      signals,
      identities,
    });
  }

  sourceFor(tool: ResearchToolName): InternalResearchSource {
    return toolDefinitions[tool].source;
  }

  private buildCall(
    request: ResearchToolRequest,
    definition: (typeof toolDefinitions)[ResearchToolName],
  ): ComposioResearchToolCall {
    const base = {
      source: definition.source,
      toolSlug: definition.toolSlug,
      version: definition.version,
      connectedAccountId:
        this.config.connectedAccountIds[definition.source],
    } satisfies Omit<ComposioResearchToolCall, "arguments">;

    switch (request.tool) {
      case "slack_search":
        return {
          ...base,
          arguments: {
            query: request.query,
            count: request.limit,
            sort: "timestamp",
            sort_dir: "desc",
            highlight: false,
            auto_paginate: false,
          },
        };
      case "granola_search":
        return { ...base, arguments: { query: request.query } };
      case "fireflies_search":
        return {
          ...base,
          arguments: {
            ...(request.email
              ? { participants: [request.email] }
              : { title: request.title }),
            limit: request.limit,
            include_summary: true,
            include_meeting_attendees: true,
          },
        };
      case "salesforce_search":
        return {
          ...base,
          arguments: {
            q: [
              `FIND {${escapeSosl(request.query)}} IN ALL FIELDS`,
              "RETURNING",
              "Account(Id, Name, Website, Description)",
              "Contact(Id, FirstName, LastName, Email, Title, AccountId)",
              "Lead(Id, FirstName, LastName, Email, Title, Company)",
              "LIMIT 20",
            ].join(" "),
          },
        };
      case "posthog_people":
        return {
          ...base,
          arguments: {
            project_id: requiredPosthogProjectId(this.config),
            ...(request.email ? { email: request.email } : {}),
            ...(request.search ? { search: request.search } : {}),
            ...(request.propertyFilters
              ? { properties: JSON.stringify(request.propertyFilters) }
              : {}),
            offset: request.offset,
            limit: request.limit,
            format: "json",
          },
        };
      case "posthog_hogql":
        assertReadOnlyHogql(request.query);
        return {
          ...base,
          arguments: {
            project_id: requiredPosthogProjectId(this.config),
            query: { kind: "HogQLQuery", query: request.query },
            async: false,
            refresh: "blocking",
          },
        };
    }
  }

  private extract(
    tool: ResearchToolName,
    result: unknown,
  ): ExtractedRecord[] {
    switch (tool) {
      case "slack_search":
        return extractSlack(result);
      case "granola_search":
        return extractGranola(result);
      case "fireflies_search":
        return extractFireflies(result);
      case "salesforce_search":
        return extractSalesforce(result);
      case "posthog_people":
        return extractPosthog(result);
      case "posthog_hogql":
        return extractPosthogHogql(result);
    }
  }
}

export function assertReadOnlyHogql(query: string): void {
  const normalized = query.trim();
  if (!/^(?:select|with)\b/i.test(normalized)) {
    throw new Error("HogQL research queries must start with SELECT or WITH");
  }
  if (
    /;|--|\/\*|\*\/|\b(?:insert|update|delete|drop|alter|truncate|create|attach|detach)\b/i.test(
      normalized,
    )
  ) {
    throw new Error("HogQL research queries must be a single read-only query");
  }
}

function requiredPosthogProjectId(config: ComposioResearchConfig): string {
  if (!config.posthogProjectId) {
    throw new Error("COMPOSIO_POSTHOG_PROJECT_ID is required for PostHog research");
  }
  return config.posthogProjectId;
}

function extractIdentities(
  records: ExtractedRecord[],
  source: InternalResearchSource,
): DiscoveredIdentity[] {
  const identities = new Map<string, DiscoveredIdentity>();
  for (const { claim } of records) {
    for (const match of claim.matchAll(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    )) {
      const email = match[0].toLowerCase();
      identities.set(`email:${email}`, { type: "email", value: email, source });
      const domain = email.split("@")[1];
      if (domain) {
        identities.set(`domain:${domain}`, {
          type: "domain",
          value: domain,
          source,
        });
      }
    }
  }
  return [...identities.values()].slice(0, 20);
}

function findFirstValue(value: unknown, wantedKey: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstValue(item, wantedKey);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (wantedKey in record) return record[wantedKey];
  for (const child of Object.values(record)) {
    const found = findFirstValue(child, wantedKey);
    if (found !== undefined) return found;
  }
  return undefined;
}

function escapeSosl(value: string): string {
  return value.replace(/[?&|!{}\[\]()^~*:\\"'+-]/g, " ").trim();
}
