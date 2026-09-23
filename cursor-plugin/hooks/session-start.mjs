#!/usr/bin/env node
let raw = ""
for await (const chunk of process.stdin) raw += chunk
try {
  JSON.parse(raw)
  process.stdout.write(`${JSON.stringify({ additional_context: "Jev routing is available through the jev-router MCP tool. Before substantive work, classify the user's current request once; use the result as advisory context and delegate to the matching jev-<mode> subagent only when useful. An explicit @jev:<mode> override takes precedence. If classification is unavailable, continue normally. Routing does not switch the parent model, force delegation, or provide a security boundary." })}\n`)
} catch {
  // Ignore malformed lifecycle payloads; session startup must remain fail-open.
}
