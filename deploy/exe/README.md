# exe.dev distributed deployment

The distributed v0 uses five VMs:

| VM | Responsibility |
| --- | --- |
| `outbound-factory-orchestrator` | Workflow state, stage routing, HTTP API, and SSE |
| `outbound-factory-research` | Persistent research Pi session and Composio reads |
| `outbound-factory-drafting` | Persistent drafting Pi session and feedback revisions |
| `outbound-factory-critic` | Mock review/deep review plus the Pi critic and deterministic policies |
| `outbound-factory-send` | Approved Slack delivery through Composio |

Every runner exposes one WebSocket through exe.dev's HTTPS proxy. The proxy is
public because the orchestrator is another VM, but `/ws` requires a shared,
high-entropy runner token. The orchestrator workflow endpoints require a
different bearer token. `/health` remains unauthenticated for uptime checks.

Secrets are deliberately scoped:

- Pi auth is installed only on research, drafting, and critic.
- The Composio project key is installed only on research and send.
- The runner token is installed on all five VMs.
- The public API token is installed only on the orchestrator.
- No SSH private keys are copied into the new VMs.

The committed systemd units run Bun from `/home/exedev/.bun/bin/bun`, load the
role-specific `/home/exedev/outbound-factory/.env`, and restart after a crash or
VM reboot. Install one after code and environment files are present:

```bash
./deploy/exe/install-service.sh runner
./deploy/exe/install-service.sh orchestrator
```

Retrieve the API token without placing it in shell history:

```bash
ssh exedev@outbound-factory-orchestrator.exe.xyz \
  'cat ~/.factory-secrets/api-token'
```

Then call the deployment:

```bash
export FACTORY_API_TOKEN='paste-token-here'

curl https://outbound-factory-orchestrator.exe.xyz/health

curl -X POST https://outbound-factory-orchestrator.exe.xyz/workflows \
  -H "Authorization: Bearer $FACTORY_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "company": {"name": "innoGPT", "domain": "inno-ki.de"},
    "prospect": {
      "firstName": "Mike",
      "lastName": "Koene",
      "email": "mike@inno-ki.de",
      "title": "Lead Developer"
    }
  }'
```

Stream a workflow with the same bearer token:

```bash
curl -N \
  -H "Authorization: Bearer $FACTORY_API_TOKEN" \
  https://outbound-factory-orchestrator.exe.xyz/workflows/WORKFLOW_ID/events
```

Operational checks:

```bash
ssh exedev@outbound-factory-research.exe.xyz \
  'sudo systemctl status outbound-factory --no-pager'

ssh exedev@outbound-factory-research.exe.xyz \
  'sudo journalctl -u outbound-factory -n 100 --no-pager'
```

The orchestrator reconnects automatically after a runner restarts. Because v0
state is still in memory, a workflow with a command actively running on a VM at
the moment of disconnection is failed rather than silently replayed. Durable
checkpoints and command acknowledgements in Postgres remain the next reliability
step.
