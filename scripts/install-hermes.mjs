#!/usr/bin/env node
import { cp, lstat, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const home = process.env.HERMES_HOME ?? join(process.env.HOME, ".hermes")
const destination = join(home, "plugins", "jev-router")
const marker = "jev-route Hermes plugin files are installer-managed\n"
let existing
try {
  existing = await lstat(destination)
} catch (error) {
  if (error?.code !== "ENOENT") throw error
}
if (existing && (!existing.isDirectory() || await readFile(join(destination, ".jev-route-managed"), "utf8").catch(() => "") !== marker)) {
  throw new Error(`Refusing to overwrite an unmanaged Hermes plugin: ${destination}`)
}
await mkdir(join(home, "plugins"), { recursive: true, mode: 0o700 })
await mkdir(destination, { recursive: true })
for (const name of [".jev-route-managed", "plugin.yaml", "__init__.py", "route.mjs"]) {
  await cp(new URL(`../hermes-plugin/${name}`, import.meta.url), join(destination, name), { force: true })
}
await cp(new URL("../shared/", import.meta.url), join(destination, "shared"), { recursive: true, force: true })
await mkdir(join(destination, "config"), { recursive: true })
await cp(new URL("../config/hermes.json", import.meta.url), join(destination, "config", "hermes.json"), { force: false })
console.log(`Installed Hermes Jev plugin in ${destination}. Enable it with: hermes plugins enable jev-router`)
