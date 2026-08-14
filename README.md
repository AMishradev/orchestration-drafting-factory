# Outbound Factory v0

A minimal Bun + TypeScript + Zod demonstration of an agent workflow with a real-time feedback loop:

```text
research → drafting → review → critic → deep review
                ↑         |
                └─ revise ┘
```

The runner and orchestrator communicate over a persistent WebSocket. The runner defaults to deterministic mock agents so running the demo never sends email, calls an LLM, or consumes API credits. The first draft intentionally includes an unsupported claim; review rejects it. The next draft uses the critic's forbidden word `fair`; critic rejects it. Both structured verdicts route back to the same drafting session.

The drafting and critic roles can each use a real local Pi RPC process. Research can use six internal systems through Composio. Review and deep review remain mocked in v0.

## Run it

```bash
bun install
bun run demo
```

The final output should have:

- `status: "approved"`
- `draftAttempt: 3`
- a first review verdict of `revise`
- a critic verdict containing `FORBIDDEN_WORD_FAIR`
- a final draft without the unsupported claim or the standalone word `fair`

To run the long-lived API:

```bash
bun run start
```

To run with real Pi drafting and critic agents:

```bash
bun run start:pi
```

To run only the Composio research agent, or all currently implemented real agents:

```bash
bun run start:composio:research
bun run start:agents
```

This internally starts a separate `pi --mode rpc` process for each active drafting and critic session. It uses Pi's existing credentials and default model, so real model usage may incur cost. To run only one Pi role:

```bash
bun run start:pi:drafting
bun run start:pi:critic
```

Generic provider and model settings apply to both roles:

```bash
PI_PROVIDER=openai PI_MODEL=MODEL_ID bun run start:pi
```

Role-specific settings override the generic values:

```bash
PI_PROVIDER=anthropic \
PI_DRAFTING_MODEL=DRAFT_MODEL_ID \
PI_CRITIC_MODEL=CRITIC_MODEL_ID \
PI_CRITIC_THINKING=high \
bun run start:pi
```

Copy `.env.example` to `.env` for local configuration if preferred. Bun loads it automatically, and `.env` is ignored by Git. Never put a real API key in `.env.example`.

Confirm the active engine:

```bash
curl http://127.0.0.1:4101/health
```

The response reports `researchEngine`, `draftingEngine`, and `criticEngine`. With `bun run start:agents`, their values are `composio`, `pi-rpc`, and `pi-rpc`. Drafting prompts ask for a short whimsical email written like a medieval knight and require raw JSON matching `DraftResultSchema`.

The critic returns a Zod-validated approve, revise, or reject verdict. The whimsical medieval-knight voice is an intentional campaign requirement, so generic `TONE_UNPROFESSIONAL` objections are ignored. It has a hard policy against the standalone word `fair`: any subject or body containing it is forced to `revise` with issue code `FORBIDDEN_WORD_FAIR`, even if Pi attempted to approve the draft.

Pi progress events from both agents are forwarded over the runner WebSocket and exposed at the workflow SSE endpoint as `agent.progress` events. Once the critic's completed verdict passes validation and policy checks, a revise verdict is immediately sent to the same persistent drafting session and appears as `feedback.routed`.

## Internal research with Composio

Set `RESEARCH_ENGINE=composio` and provide the project key only through the ignored `.env` file or process environment:

```bash
RESEARCH_ENGINE=composio \
COMPOSIO_API_KEY=YOUR_PROJECT_KEY \
COMPOSIO_USER_ID=default \
bun run start
```

The project API key authenticates the Composio project. Each source also needs a connected account for the same `COMPOSIO_USER_ID`. The research fan-out uses these read-only, dated tool definitions:

| Source | Tool |
| --- | --- |
| Slack | `SLACK_SEARCH_MESSAGES` |
| Granola | `GRANOLA_MCP_QUERY_GRANOLA_MEETINGS` |
| Fireflies | `FIREFLIES_GET_TRANSCRIPTS` |
| Salesforce | `SALESFORCE_EXECUTE_SOSL_SEARCH` |
| PostHog | `POSTHOG_LIST_OR_DELETE_PERSONS_WITH_OPTIONAL_FILTERS` in list-only mode |
| Metabase | `METABASE_CREATE_CARD_QUERY1`, which executes a saved card query |

PostHog requires `COMPOSIO_POSTHOG_PROJECT_ID`. Metabase requires `COMPOSIO_METABASE_CARD_ID` for a read-only saved card; its template tags default to `person` and `company` and can be renamed with `COMPOSIO_METABASE_PERSON_TAG` and `COMPOSIO_METABASE_COMPANY_TAG`.

Sources run concurrently and fail independently. Each useful result is reduced to a bounded signal and immediately emits `research.signal.available`; full raw connector responses are not stored in the workflow. The current partial set is visible under `researchSignals`, and the final normalized set is passed to every downstream stage as the research artifact. Other live events include:

```text
research.source.started
research.source.completed
research.source.failed
```

If no connected source returns a usable match, the workflow continues with a single signal containing only the prospect/company data supplied in the request.

Start a workflow:

```bash
curl -X POST http://127.0.0.1:4100/workflows \
  -H 'Content-Type: application/json' \
  -d '{
    "company": {"name": "innoGPT", "domain": "innogpt.de"},
    "prospect": {
      "firstName": "Mike",
      "lastName": "Koene",
      "title": "Lead Developer"
    }
  }'
```

Then use the returned workflow ID:

```bash
curl http://127.0.0.1:4100/workflows/WORKFLOW_ID
curl -N http://127.0.0.1:4100/workflows/WORKFLOW_ID/events
```

## Components

- `src/orchestrator.ts`: workflow state machine, WebSocket client, feedback routing, HTTP and SSE endpoints.
- `src/runner.ts`: WebSocket server and session registry.
- `src/mock-agent.ts`: deterministic research, drafting, review, critic, and deep-review behavior.
- `src/research-agent.ts`: research interface and mock implementation.
- `src/composio-research-agent.ts`: concurrent source execution, progress streaming, failure isolation, and normalization.
- `src/research-source-adapters.ts`: bounded read-only queries and source-specific result extraction.
- `src/drafting-agent.ts`: the drafting interface and mock implementation.
- `src/critic-agent.ts`: critic interface, mock implementation, and deterministic critic policy.
- `src/pi-command.ts`: shared role-aware Pi command configuration.
- `src/pi-rpc-client.ts`: strict JSONL client for a local `pi --mode rpc` child process.
- `src/pi-drafting-agent.ts`: medieval-knight prompt, Zod validation, correction retries, and session reuse.
- `src/pi-critic-agent.ts`: critic prompt, verdict validation, progress streaming, and session reuse.
- `src/contracts.ts`: all Zod schemas and TypeScript contracts.
- `src/event-hub.ts`: in-memory event history and SSE fan-out.

## Deliberate v0 limitations

- State is in memory; restarting either process loses active workflows.
- Orchestrator and runner start in the same OS process for easy local testing, though they still communicate over WebSocket.
- There is one generic runner rather than one runner per VM.
- No WebSocket reconnection or command redelivery yet.
- Review and deep review remain mocked. Research, drafting, and critic are selected independently with `RESEARCH_ENGINE=mock|composio`, `DRAFTING_ENGINE=mock|pi`, and `CRITIC_ENGINE=mock|pi`.
- No email is sent.

The next production step is to persist workflow checkpoints, commands, artifacts, and acknowledgements in Postgres, then deploy the same runner on separate exe.dev VMs.
