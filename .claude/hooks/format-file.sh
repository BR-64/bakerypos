#!/bin/bash
# PostToolUse hook: prettier-format whatever file was just written.
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | node "$CLAUDE_PROJECT_DIR/.claude/hooks/json-get.cjs" tool_input.file_path)
[ -z "$FILE_PATH" ] && exit 0
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.css|*.json|*.md|*.html)
    cd "$CLAUDE_PROJECT_DIR" && npx --no-install prettier --write "$FILE_PATH" >/dev/null 2>&1
    ;;
esac
exit 0
