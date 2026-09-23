#!/usr/bin/env node
import { mkdir, readFile, lstat, writeFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { join } from "node:path"

const configure = process.argv.slice(2).join(" ") === "--configure"
if (process.argv.length > 2 && !configure) throw new Error("Usage: node configure-claude.mjs [--configure]")
if (configure && !stdin.isTTY) throw new Error("--configure requires an interactive terminal")

const modes = ["TRIVIAL", "FAST", "NORMAL", "DEEP", "CRITICAL"]
const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME, ".claude")
const settingsPath = join(configDir, "jev-route.models.json")
const agentsDir = join(configDir, "agents")
const defaults = JSON.parse(await readFile(new URL("../config/claude.json", import.meta.url), "utf8")).modelsByMode
const validModel = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._/:\[\]-]{0,199}$/.test(value)

let configured
try {
  configured = JSON.parse(await readFile(settingsPath, "utf8")).modelsByMode
} catch (error) {
  if (error?.code !== "ENOENT") throw error
}
const models = { ...defaults, ...configured }
if (configure) {
  const prompt = createInterface({ input: stdin, output: stdout })
  try {
    for (const mode of modes) {
      while (true) {
        const answer = (await prompt.question(`${mode} subagent model [${models[mode]}]: `)).trim()
        const chosen = answer || models[mode]
        if (validModel(chosen)) {
          models[mode] = chosen
          break
        }
        console.log("Use a Claude model alias (inherit, haiku, sonnet, opus) or a model ID.")
      }
    }
  } finally {
    prompt.close()
  }
}
if (!modes.every(mode => validModel(models[mode]))) throw new Error("Invalid tier model settings")

const descriptions = {
  TRIVIAL: "Small, read-only or immediately reversible delegated tasks.",
  FAST: "Narrow, low-risk delegated tasks requiring quick verification.",
  NORMAL: "Bounded delegated work requiring standard verification.",
  DEEP: "Complex delegated investigation or implementation requiring thorough verification.",
  CRITICAL: "Sensitive or high-impact delegated work requiring careful review and verification.",
}
const marker = "<!-- Managed by jev-route configure-claude.mjs -->"
const files = modes.map(mode => {
  const name = `jev-${mode.toLowerCase()}`
  return {
    path: join(agentsDir, `${name}.md`),
    content: `---\nname: ${name}\ndescription: ${descriptions[mode]} Use only when Jev recommends ${mode} and the parent delegates.\nmodel: ${JSON.stringify(models[mode])}\n---\n${marker}\n\nComplete the delegated task using the specified model. Respect the user's instructions and current project rules. Report what you did and what you verified to the parent; do not claim this subagent changes the parent's session model or provides a security boundary.\n`,
  }
})
for (const file of files) {
  let info
  try {
    info = await lstat(file.path)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  if (info && (!info.isFile() || !(await readFile(file.path, "utf8")).includes(marker))) {
    throw new Error(`Refusing to overwrite unmanaged Claude agent: ${file.path}`)
  }
}
await mkdir(agentsDir, { recursive: true, mode: 0o700 })
for (const file of files) await writeFile(file.path, file.content, { mode: 0o600 })
await writeFile(settingsPath, `${JSON.stringify({ version: 1, modelsByMode: models }, null, 2)}\n`, { mode: 0o600 })
console.log(`Configured five Claude tier subagents in ${agentsDir}`)
