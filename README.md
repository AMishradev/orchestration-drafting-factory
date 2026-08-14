# Outbound Factory v0

A minimal Bun + TypeScript + Zod demonstration of an agent workflow with a real-time feedback loop:

```text
research → drafting → review → critic → deep review
                ↑         |
                └─ revise ┘
```

The runner and orchestrator communicate over a persistent WebSocket. The runner defaults to deterministic mock agents so running the demo never sends email, calls an LLM, or consumes API credits. The first draft intentionally includes an unsupported claim; review rejects it, and the orchestrator routes structured feedback back to the same drafting session.

The drafting role can also use a real local Pi RPC process while the other roles remain mocked.

## Run it

```bash
bun install
bun run demo
```

The final output should have:

- `status: "approved"`
- `draftAttempt: 2`
- a first review verdict of `revise`
- a revised draft without the unsupported claim

To run the long-lived API:

```bash
bun run start
```

To run with the real Pi drafting agent:

```bash
bun run start:pi
```

This internally starts `pi --mode rpc` when drafting work arrives. It uses Pi's existing credentials and default model, so real model usage may incur cost. Optional overrides:

```bash
PI_PROVIDER=openai PI_MODEL=MODEL_ID bun run start:pi
```

Confirm the active engine:

```bash
curl http://127.0.0.1:4101/health
```

The response contains `"draftingEngine":"pi-rpc"`. Drafting prompts ask for a short whimsical email written like a medieval knight and require raw JSON matching `DraftResultSchema`. Pi progress events are forwarded to the workflow's SSE endpoint as `agent.progress` events.

Start a workflow:

```bash
curl -X POST http://127.0.0.1:4100/workflows \
  -H 'Content-Type: application/json' \
  -d '{
    "company": {"name": "Acme", "domain": "acme.example"},
    "prospect": {"firstName": "Maya", "title": "VP of Sales"}
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
- `src/drafting-agent.ts`: the drafting interface and mock implementation.
- `src/pi-rpc-client.ts`: strict JSONL client for a local `pi --mode rpc` child process.
- `src/pi-drafting-agent.ts`: medieval-knight prompt, Zod validation, correction retries, and session reuse.
- `src/contracts.ts`: all Zod schemas and TypeScript contracts.
- `src/event-hub.ts`: in-memory event history and SSE fan-out.

## Deliberate v0 limitations

- State is in memory; restarting either process loses active workflows.
- Orchestrator and runner start in the same OS process for easy local testing, though they still communicate over WebSocket.
- There is one generic runner rather than one runner per VM.
- No WebSocket reconnection or command redelivery yet.
- Research, review, critic, and deep review remain mocked. Drafting is selected with `DRAFTING_ENGINE=mock|pi`.
- No email is sent.

The next production step is to persist workflow checkpoints, commands, artifacts, and acknowledgements in Postgres, then deploy the same runner on separate exe.dev VMs.
