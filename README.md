# Outbound Factory v0

A minimal Bun + TypeScript + Zod demonstration of an agent workflow with a real-time feedback loop:

```text
research → drafting → review → critic → deep review → send → sent
                ↑         |
                └─ revise ┘
```

The runner and orchestrator communicate over a persistent WebSocket. The runner defaults to deterministic mock agents, including a simulated send, so running the demo never posts to Slack, sends email, calls an LLM, or consumes API credits. The first draft intentionally includes an unsupported claim; review rejects it. The next draft uses the critic's forbidden word `fair`; critic rejects it. Both structured verdicts route back to the same drafting session.

The drafting and critic roles can each use a real local Pi RPC process. Research can use six internal systems through Composio. The send agent can deliver the approved subject and body to Archit in a Slack DM through Composio. Review and deep review remain mocked in v0.

## Run it

```bash
bun install
bun run demo
```

The final output should have:

- `status: "sent"`
- `sendResult.delivery: "simulated"`
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

To run only the Composio research agent, only the real Slack send agent, or all currently implemented real agents:

```bash
bun run start:composio:research
bun run start:composio:send
bun run start:agents
```

`start:composio:send` and `start:agents` perform a real Slack write after approval. `bun run start` and `bun run demo` always use the simulated send agent.

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

The response reports `researchEngine`, `draftingEngine`, `criticEngine`, and `sendEngine`. With `bun run start:agents`, their values are `composio`, `pi-rpc`, `pi-rpc`, and `composio-slack`. Drafting prompts ask for a short whimsical email written like a medieval knight and require raw JSON matching `DraftResultSchema`.

The critic returns a Zod-validated approve, revise, or reject verdict. The whimsical medieval-knight voice is an intentional campaign requirement, so generic `TONE_UNPROFESSIONAL` objections are ignored. It has a hard policy against the standalone word `fair`: any subject or body containing it is forced to `revise` with issue code `FORBIDDEN_WORD_FAIR`, even if Pi attempted to approve the draft.

Pi progress events from both agents are forwarded over the runner WebSocket and exposed at the workflow SSE endpoint as `agent.progress` events. Once the critic's completed verdict passes validation and policy checks, a revise verdict is immediately sent to the same persistent drafting session and appears as `feedback.routed`.

## Internal research with Composio

Set `RESEARCH_ENGINE=composio` and provide the project key only through the ignored `.env` file or process environment:

```bash
RESEARCH_ENGINE=composio \
COMPOSIO_API_KEY=YOUR_PROJECT_KEY \
COMPOSIO_USER_ID=YOUR_CONNECTED_ACCOUNT_USER_ID \
bun run start
```

The project API key authenticates and selects the Composio project; the project ID is not passed separately to the SDK. Each source also needs an active connected account for the exact `COMPOSIO_USER_ID`. The app intentionally has no `default` fallback, so a missing user ID fails at startup instead of producing six misleading source failures.

If a user has multiple connected accounts for a toolkit, select one explicitly with `COMPOSIO_<SOURCE>_CONNECTED_ACCOUNT_ID` (for example, `COMPOSIO_GRANOLA_CONNECTED_ACCOUNT_ID`). Use the connected-account ID beginning with `ca_`, not the auth-config ID beginning with `ac_`.

The research fan-out uses these read-only, dated tool definitions:

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

## Slack send agent

The send stage runs only after deep review approves the draft. It removes em dashes, en dashes, and semicolons from the subject and body, normalizes whitespace, and formats this Slack payload:

```text
## Outbound email

**To:** Mike Koene, Lead Developer at innoGPT
**Subject:** ...

**Body:**
...
```

Configure real delivery in the ignored `.env` file:

```bash
SEND_ENGINE=composio-slack
COMPOSIO_API_KEY=YOUR_PROJECT_KEY
COMPOSIO_USER_ID=YOUR_CONNECTED_ACCOUNT_USER_ID
COMPOSIO_SLACK_CONNECTED_ACCOUNT_ID=ca_YOUR_SLACK_ACCOUNT
COMPOSIO_SLACK_RECIPIENT_QUERY=archit
# Safest after resolving Archit once:
COMPOSIO_SLACK_RECIPIENT_USER_ID=U_YOUR_EXACT_ARCHIT_ID
```

The tools are pinned to the inspected Slack schemas: `SLACK_FIND_USERS`, `SLACK_OPEN_DM`, and `SLACK_SEND_MESSAGE`. When no exact user ID is configured, `archit` is searched at runtime. The send is blocked unless exactly one user matches, preventing a name collision from messaging the wrong person. The agent then opens that user's DM channel and posts the Markdown payload. Live SSE events are:

```text
send.recipient.resolved
send.dm.opened
send.message.sent
outbound.sent
workflow.sent
```

To test only formatting and orchestration without a Slack write:

```bash
bun run start
```

To perform the real Slack send using mock upstream agents:

```bash
bun run start:composio:send
```

In another terminal, create the workflow using the curl request below and watch the stream. A successful mock run ends with `status: "sent"` and `delivery: "simulated"`; a real Slack run ends with `delivery: "sent"`.

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
- `src/outbound-format.ts`: deterministic punctuation cleanup and Slack Markdown formatting.
- `src/send-agent.ts`: typed send interface and side-effect-free mock implementation.
- `src/composio-slack-send-agent.ts`: unambiguous recipient resolution, DM opening, and Slack delivery through Composio.
- `src/contracts.ts`: all Zod schemas and TypeScript contracts.
- `src/event-hub.ts`: in-memory event history and SSE fan-out.

## Deliberate v0 limitations

- State is in memory; restarting either process loses active workflows.
- Orchestrator and runner start in the same OS process for easy local testing, though they still communicate over WebSocket.
- There is one generic runner rather than one runner per VM.
- No WebSocket reconnection or command redelivery yet.
- Review and deep review remain mocked. Research, drafting, critic, and send are selected independently with `RESEARCH_ENGINE=mock|composio`, `DRAFTING_ENGINE=mock|pi`, `CRITIC_ENGINE=mock|pi`, and `SEND_ENGINE=mock|composio-slack`.
- The v0 delivery target is a Slack DM to Archit; it does not send the outbound email to the prospect yet.

The next production step is to persist workflow checkpoints, commands, artifacts, and acknowledgements in Postgres, then deploy the same runner on separate exe.dev VMs.
