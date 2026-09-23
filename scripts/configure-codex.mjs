#!/usr/bin/env node
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { join } from "node:path"

const configure = process.argv.slice(2).join(" ") === "--configure"
if (process.argv.length > 2 && !configure) throw new Error("Usage: node configure-codex.mjs [--configure]")
if (configure && !stdin.isTTY) throw new Error("--configure requires an interactive terminal")

const modes = ["TRIVIAL", "FAST", "NORMAL", "DEEP", "CRITICAL"]
const configDir = process.env.CODEX_HOME ?? join(process.env.HOME, ".codex")
const settingsPath = join(configDir, "jev-route.models.json")
const agentsDir = join(configDir, "agents")
const defaults = JSON.parse(await readFile(new URL("../config/codex.json", import.meta.url), "utf8")).modelsByMode
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
        const answer = (await prompt.question(`${mode} Codex subagent model [${models[mode]}]: `)).trim()
        const chosen = answer || models[mode]
        if (validModel(chosen)) {
          models[mode] = chosen
          break
        }
        console.log("Use inherit or a Codex model ID available to your account.")
      }
    }
  } finally {
    prompt.close()
  }
}
if (!modes.every(mode => validModel(models[mode]))) throw new Error("Invalid Codex tier model settings")

const descriptions = {
  TRIVIAL: "Small, read-only or immediately reversible delegated work.",
  FAST: "Narrow, low-risk delegated work requiring quick verification.",
  NORMAL: "Bounded delegated work requiring standard verification.",
  DEEP: "Complex delegated investigation or implementation requiring thorough verification.",
  CRITICAL: "Sensitive or high-impact delegated work requiring careful review and verification.",
}
const marker = "# Managed by jev-route configure-codex.mjs"
const files = modes.map(mode => {
  const name = `jev_${mode.toLowerCase()}`
  const model = models[mode] === "inherit" ? "" : `model = ${JSON.stringify(models[mode])}\n`
  return {
    path: join(agentsDir, `${name}.toml`),
    content: `${marker}\nname = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(`${descriptions[mode]} Use when Jev recommends ${mode} and the parent delegates.`)}\n${model}developer_instructions = """\nComplete the delegated task. Respect the user's instructions and project rules. Report your work and verification to the parent. Your model assignment does not change the parent's model or provide a security boundary.\n"""\n`,
  }
})
for (const file of files) {
  let info
  try {
    info = await lstat(file.path)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  if (info && (!info.isFile() || !(await readFile(file.path, "utf8")).startsWith(marker))) {
    throw new Error(`Refusing to overwrite unmanaged Codex agent: ${file.path}`)
  }
}
await mkdir(agentsDir, { recursive: true, mode: 0o700 })
for (const file of files) await writeFile(file.path, file.content, { mode: 0o600 })
await writeFile(settingsPath, `${JSON.stringify({ version: 1, modelsByMode: models }, null, 2)}\n`, { mode: 0o600 })
console.log(`Configured five Codex tier subagents in ${agentsDir}`)
