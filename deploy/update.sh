#!/usr/bin/env bash
# Pull latest code, rebuild, and restart hl-newlisting under PM2.
# Run from anywhere; the script resolves the project root from its own location.
#
#   ~/hl-newlisting/deploy/update.sh
# or, from inside the project:
#   ./deploy/update.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="hl-newlisting"
BRANCH="${BRANCH:-main}"

cd "$PROJECT_DIR"

# Refuse to run with a dirty working tree — we'd lose those changes on pull.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: uncommitted changes in $PROJECT_DIR. Commit, stash, or revert first." >&2
  git status --short >&2
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "$BRANCH" ]; then
  echo "WARN: on branch '$current_branch', expected '$BRANCH'. Continuing anyway." >&2
fi

echo "==> Fetching $BRANCH..."
git fetch origin "$BRANCH"

local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse "origin/$BRANCH")"

if [ "$local_sha" = "$remote_sha" ]; then
  echo "    Already at $local_sha — nothing to pull."
  pulled=0
else
  echo "==> Pulling $local_sha -> $remote_sha"
  git pull --ff-only origin "$BRANCH"
  pulled=1
fi

echo "==> Installing dependencies..."
npm ci

echo "==> Building..."
npm run build

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "==> Restarting PM2 app: $APP_NAME"
  pm2 restart "$APP_NAME" --update-env
else
  echo "==> $APP_NAME not running — starting from ecosystem.config.cjs"
  pm2 start ecosystem.config.cjs
  pm2 save
fi

echo
echo "==> Done. Status:"
pm2 status "$APP_NAME"
echo
echo "Tail logs with:  pm2 logs $APP_NAME --lines 50"

if [ "$pulled" -eq 0 ]; then
  echo "Note: no new commits were pulled — only rebuild + restart was performed."
fi
