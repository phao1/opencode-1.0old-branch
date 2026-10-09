#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 ]]; then
  echo "Usage: bash start-opencode.sh PROJECT [opencode arguments...]" >&2
  exit 2
fi
bundle=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
cd -- "$1"
shift
export OPENCODE_CONFIG_DIR="$bundle/.opencode"
export OPENCODE_DISABLE_PROJECT_CONFIG=true
exec "$bundle/opencode" "$@"
