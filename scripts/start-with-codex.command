#!/usr/bin/env bash
set -euo pipefail
codex_launcher_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
codex_node=${NODE_BINARY:-}
if [[ -z "$codex_node" ]]; then codex_node=$(command -v node || true); fi
if [[ -n "$codex_node" ]] && ! "$codex_node" -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)' >/dev/null 2>&1; then codex_node=""; fi
if [[ -z "$codex_node" && -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  codex_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ -z "$codex_node" ]]; then echo "本入口需要 Node.js 24 或以上版本。" >&2; exit 2; fi
if [[ -f "$codex_launcher_dir/codex-bridge/start-with-codex.mjs" ]]; then
  exec "$codex_node" "$codex_launcher_dir/codex-bridge/start-with-codex.mjs" "$@"
fi
exec "$codex_node" "$codex_launcher_dir/start-with-codex.mjs" "$@"
