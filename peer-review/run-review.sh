#!/bin/sh
# Usage: peer-review/run-review.sh <round> <gpt-6-astra|grok-4.6>
# Runs one reviewer on a fresh snapshot and stores everything it returns in
# peer-review/round-<round>/. From round 2 on, the reviewer also gets its own
# previous report, the response to it and the diff of the protocol.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
N=$1
WHO=$2
OUT="$HERE/round-$N"
WS="${REVIEW_WORKDIR:-${TMPDIR:-/tmp}/asom-review}/round-$N/$WHO"
mkdir -p "$OUT"
"$HERE/snapshot.sh" "$WS"
PROMPT="$HERE/prompts/round-1.md"
if [ "$N" -gt 1 ]; then
  P=$((N - 1))
  PROMPT="$HERE/prompts/round-n.md"
  cp "$HERE/round-$P/$WHO.json" "$WS/previous-review.json"
  cp "$HERE/round-$P/response-$WHO.md" "$WS/response.md"
  diff -u --label "round-$P/protocol.md" --label protocol.md "$HERE/round-$P/protocol.md" "$WS/protocol.md" > "$WS/protocol.diff"
fi
cp "$WS/protocol.md" "$OUT/protocol.md"
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
case "$WHO" in
  gpt-6-astra)
    VERSION=$(codex --version)
    timeout 5400 codex exec --skip-git-repo-check -s read-only -C "$WS" -m gpt-6-astra \
      -c model_reasoning_effort='"xhigh"' --output-schema "$HERE/review-schema.json" \
      --json -o "$OUT/$WHO.json" - < "$PROMPT" > "$OUT/$WHO.events.jsonl" 2> "$OUT/$WHO.stderr"
    STATUS=$? ;;
  grok-4.6)
    VERSION=$(grok --version | head -1)
    timeout 5400 grok --prompt-file "$PROMPT" -m grok-4.6 --reasoning-effort xhigh \
      --permission-mode plan --cwd "$WS" --no-subagents --max-turns 80 --output-format json \
      > "$OUT/$WHO.raw.json" 2> "$OUT/$WHO.stderr"
    STATUS=$? ;;
  *) echo "unknown reviewer $WHO" >&2; exit 2 ;;
esac
# The workspace path says nothing about the review; keep it out of the record.
for f in "$OUT/$WHO".*; do sed -i '' "s|$WS|<workspace>|g" "$f"; done
printf '{"reviewer": "%s", "cli": "%s", "reasoning_effort": "xhigh", "round": %s, "started": "%s", "finished": "%s", "exit_status": %s}\n' \
  "$WHO" "$VERSION" "$N" "$STARTED" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STATUS" > "$OUT/$WHO.meta.json"
exit "$STATUS"
