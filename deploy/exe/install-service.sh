#!/usr/bin/env bash
set -euo pipefail

service_kind="${1:-}"
case "$service_kind" in
  runner|orchestrator) ;;
  *) echo "usage: $0 runner|orchestrator" >&2; exit 2 ;;
esac

cd /home/exedev/outbound-factory
if [[ ! -x /home/exedev/.bun/bin/bun ]]; then
  curl -fsSL https://bun.sh/install | bash
fi
/home/exedev/.bun/bin/bun install --frozen-lockfile

sudo install -m 0644 \
  "deploy/exe/outbound-factory-${service_kind}.service" \
  /etc/systemd/system/outbound-factory.service
sudo systemctl daemon-reload
sudo systemctl enable --now outbound-factory.service
