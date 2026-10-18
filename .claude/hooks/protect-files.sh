#!/bin/bash
# PreToolUse hook: block edits to files agents must never touch.
# Exit 2 = block the tool call and feed the message back to the agent.
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | node "$CLAUDE_PROJECT_DIR/.claude/hooks/json-get.cjs" tool_input.file_path)
[ -z "$FILE_PATH" ] && exit 0
FILE_PATH="${FILE_PATH//\\//}"

PROTECTED_PATTERNS=(".env" "package-lock.json" ".git/" "dev-dist/" "dist/" "node_modules/")
for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: $FILE_PATH matches protected pattern '$pattern'. See CLAUDE.md." >&2
    exit 2
  fi
done
exit 0
