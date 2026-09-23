#!/usr/bin/env node
import { cp, lstat, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const cursorHome = process.env.CURSOR_HOME ?? join(process.env.HOME, ".cursor")
const pluginDir = join(cursorHome, "plugins", "local", "jev-router")
const sourceDir = new URL("../cursor-plugin/", import.meta.url)
const marker = "jev-route cursor plugin files are installer-managed\n"

let existing
try {
  existing = await lstat(pluginDir)
} catch (error) {
  if (error?.code !== "ENOENT") throw error
}
if (existing && (!existing.isDirectory() || await readFile(join(pluginDir, ".jev-route-managed"), "utf8").catch(() => "") !== marker)) {
  throw new Error(`Refusing to overwrite an unmanaged Cursor plugin: ${pluginDir}`)
}
await mkdir(join(cursorHome, "plugins", "local"), { recursive: true, mode: 0o700 })
await cp(sourceDir, pluginDir, { recursive: true, force: true })
await cp(new URL("../shared/", import.meta.url), join(pluginDir, "shared"), { recursive: true, force: true })
console.log(`Installed Cursor local plugin in ${pluginDir}. Reload Cursor to activate it.`)
