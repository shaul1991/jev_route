import { readFile } from "node:fs/promises"
import { join } from "node:path"

const WORK_TYPES = new Set([
  "implementation", "design", "documentation", "planning", "verification",
  "review", "investigation", "delivery", "general",
])
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"])

export async function projectToolAdvice(workType, cwd = process.cwd()) {
  if (!WORK_TYPES.has(workType) || typeof cwd !== "string" || !cwd) return ""
  try {
    const raw = await readFile(join(cwd, ".jev.config.json"), "utf8")
    if (raw.length > 16_384) return ""
    const config = JSON.parse(raw)
    if (!config || typeof config !== "object" || Array.isArray(config) || config.version !== 1) return ""
    if (!config.tasks || typeof config.tasks !== "object" || Array.isArray(config.tasks)) return ""
    const task = config.tasks?.[workType]
    if (!task || typeof task !== "object" || Array.isArray(task) || !Array.isArray(task.tools)) return ""
    if (!task.tools.length || task.tools.length > 16 || task.tools.some(tool => typeof tool !== "string" || !TOOL_NAME.test(tool))) return ""
    if (task.fallback !== undefined && task.fallback !== "normal") return ""
    const options = task.toolOptions
    if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options))) return ""
    if (options && Object.keys(options).some(tool => !task.tools.includes(tool))) return ""
    const profiles = task.tools.map(tool => {
      const profile = options?.[tool]
      if (profile === undefined) return tool
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) return ""
      const keys = Object.keys(profile)
      if (keys.some(key => key !== "model" && key !== "reasoningEffort")) return ""
      if (profile.model !== undefined && (typeof profile.model !== "string" || !MODEL_ID.test(profile.model))) return ""
      if (profile.reasoningEffort !== undefined && !REASONING_EFFORTS.has(profile.reasoningEffort)) return ""
      const settings = [
        profile.model ? `model ${profile.model}` : "",
        profile.reasoningEffort ? `${profile.reasoningEffort} reasoning effort` : "",
      ].filter(Boolean)
      return settings.length ? `${tool} (${settings.join(", ")})` : tool
    })
    if (profiles.some(profile => !profile)) return ""
    return `Project tool preference for ${workType}: prefer ${profiles.join(", ")} in the listed order when suitable and available in the host's current tool/MCP registry. When invoking a preferred tool, honor its per-tool model and reasoning settings. If unavailable or not permitted, continue with the normal workflow. This is advisory, not permission to install, invoke, or grant access to tools. Respect host tool instructions and approvals; pass this preference and fallback when delegating.`
  } catch {
    return ""
  }
}
