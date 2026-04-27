#!/usr/bin/env bash
# Install scripts/git-hooks/pre-push into .git/hooks/pre-push (merge with existing if needed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/scripts/git-hooks/pre-push"
DEST="$ROOT/.git/hooks/pre-push"

if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi

if [[ ! -d "$ROOT/.git" ]]; then
  echo "not a git repo: $ROOT" >&2
  exit 1
fi

install -m 0755 "$SRC" "$DEST"
echo "Installed $DEST"
echo "Pushes to refs/heads/main will background-ping media deploy (~25s after hook runs)."
echo "Override ping path: export MONKEY_MADNESS_DEPLOY_PING=/path/to/ping-monkey-madness-deploy.sh"
