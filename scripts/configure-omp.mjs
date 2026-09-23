#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"

const [configPath, templatePath, option] = process.argv.slice(2)
if (!configPath || !templatePath || (option && option !== "--prompt")) {
  throw new Error("Usage: node configure-omp.mjs <installed-config> <template-config> [--prompt]")
}

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value)
const [existing, template] = await Promise.all([
  readFile(configPath, "utf8").then(JSON.parse),
  readFile(templatePath, "utf8").then(JSON.parse),
])
if (!isRecord(existing) || !isRecord(template)) throw new Error("OMP settings must be JSON objects")
const original = `${JSON.stringify(existing, null, 2)}\n`

function addMissingDefaults(current, defaults) {
  if (!isRecord(current) || !isRecord(defaults)) return current
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(current, key)) current[key] = structuredClone(value)
    else addMissingDefaults(current[key], value)
  }
  return current
}

const config = addMissingDefaults(existing, template)
if (option === "--prompt") {
  const modes = ["TRIVIAL", "FAST", "NORMAL", "DEEP", "CRITICAL"]
  const defaults = {
    TRIVIAL: "@tiny",
    FAST: "@smol",
    NORMAL: "@default",
    DEEP: "@slow",
    CRITICAL: "@slow",
  }
  const configured = { ...defaults, ...config.tierRolesByMode }
  const prompt = createInterface({ input: stdin, output: stdout })
  try {
    for (const mode of modes) {
      while (true) {
        const answer = (await prompt.question(`${mode} preferred OMP role alias [${configured[mode]}]: `)).trim()
        const alias = answer || configured[mode]
        if (/^@[A-Za-z0-9_-]{1,64}$/.test(alias)) {
          configured[mode] = alias
          break
        }
        console.log("Enter an OMP role alias such as @smol or @my-fast-role.")
      }
    }
  } finally {
    prompt.close()
  }
  config.tierRolesByMode = configured
}

const output = `${JSON.stringify(config, null, 2)}\n`
if (output !== original) {
  const temporaryPath = `${configPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, output, { mode: 0o600 })
  await rename(temporaryPath, configPath)
}
console.log(option === "--prompt"
  ? `Saved five tier role aliases to ${configPath}`
  : `Preserved OMP settings and filled missing defaults in ${configPath}`)
