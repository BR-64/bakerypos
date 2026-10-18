#!/bin/bash
# Stop hook: when the agent thinks it is finished, make sure the suite still passes.
# If tests fail, exit 2 sends the failure back and the agent keeps working.
# Only runs when source files changed, so a chat-only turn is not slowed down.
INPUT=$(cat)
# Avoid infinite loops: if we already blocked once this turn, let it stop.
if [ "$(printf '%s' "$INPUT" | node "$CLAUDE_PROJECT_DIR/.claude/hooks/json-get.cjs" stop_hook_active)" = "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR" || exit 0
if git diff --quiet HEAD -- src 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard src)" ]; then
  exit 0
fi
OUT=$(npm test 2>&1)
if [ $? -ne 0 ]; then
  echo "Tests are failing — fix them before finishing (CLAUDE.md definition of done):" >&2
  echo "$OUT" | tail -40 >&2
  exit 2
fi
OUT=$(npm run typecheck 2>&1)
if [ $? -ne 0 ]; then
  echo "Typecheck failing — fix before finishing:" >&2
  echo "$OUT" | tail -40 >&2
  exit 2
fi
exit 0
