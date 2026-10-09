#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "Usage: bash start-worker.sh PROJECT" >&2
  exit 2
fi
bundle=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
cd -- "$1"
exec node "$bundle/one-shot.mjs" worker
