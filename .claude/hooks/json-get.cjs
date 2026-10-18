// Print one field of the hook's JSON input (stdin), e.g. `tool_input.file_path`.
// Prints nothing if the input isn't JSON or the field is missing.
// Used instead of jq, which isn't installed on every dev machine (Git Bash on Windows).
let input = ''
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  try {
    let value = JSON.parse(input)
    for (const key of (process.argv[2] ?? '').split('.')) value = value?.[key]
    if (value !== undefined && value !== null) process.stdout.write(String(value))
  } catch {
    // Not JSON: print nothing.
  }
})
