#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  bundled_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  bundled_tools="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"
  export PATH="$bundled_node:$bundled_tools:$PATH"
fi
if [ ! -d .venv ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -r requirements.txt
(cd frontend && pnpm install --frozen-lockfile && pnpm run build)
printf '\nPYRAMID DNA: http://127.0.0.1:8000/app/\n'
exec .venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8000
