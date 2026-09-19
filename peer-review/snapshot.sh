#!/bin/sh
# Usage: peer-review/snapshot.sh <workspace>
# Copies the protocol and the study software into a fresh reviewer workspace:
# no .env, databases, logs or dependencies, and no machine names.
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
WS=$1
rm -rf "$WS"
mkdir -p "$WS/software"
cp "$REPO/study_protocol.md" "$WS/protocol.md"
cd "$REPO"
rsync -a --relative \
  analysis/mood.stan analysis/day_satisfaction.stan analysis/mood.R analysis/secondary.R analysis/refit.R \
  analysis/simulate.R analysis/design.R analysis/prior_check.R analysis/tests \
  server scripts/cli.ts site/index.html site/results.js static/js static/sw.js tests README.md package.json \
  "$WS/software/"
for f in analysis/design-*.csv analysis/design-*.txt; do if [ -f "$f" ]; then cp "$f" "$WS/software/analysis/"; fi; done
if [ -d analysis/design-v3-shared-prior ]; then cp -R analysis/design-v3-shared-prior "$WS/software/analysis/"; fi
sed -i '' -E 's/[a-z0-9-]+\.tail[0-9a-f]+\.ts\.net/<machine>.<tailnet>.ts.net/g' "$WS/software/README.md"
find "$WS" -name .DS_Store -delete
