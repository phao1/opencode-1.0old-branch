#!/bin/sh
set -eu
skill_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
target_root=${ONESHOT_INSTALL_DIR:-"$HOME/.agents/skills"}
target="$target_root/one-shot"
mkdir -p "$target_root"
if [ -L "$target" ] && [ "$(readlink "$target")" = "$skill_dir" ]; then
  echo "已安装：$target -> $skill_dir"
  exit 0
fi
if [ -e "$target" ] || [ -L "$target" ]; then
  echo "拒绝覆盖已有路径：$target" >&2
  exit 1
fi
ln -s "$skill_dir" "$target"
echo "已安装：$target -> $skill_dir"
