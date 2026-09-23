#!/usr/bin/env node
import { requestJev } from "../shared/jev-api.mjs"
import { ALM_ROLE_CRITERIA, buildRoutingQuestions, ROUTING_THRESHOLDS } from "../shared/jev-routing.mjs"
import { readFileSync } from "node:fs"
const claudeConfigJson = JSON.parse(readFileSync(new URL("../config/claude.json", import.meta.url), "utf8"))

function loadClaudeConfig(value) {
  if (
    value === null || typeof value !== "object" || Array.isArray(value)
    || value.version !== 1 || typeof value.enabled !== "boolean"
    || !Number.isInteger(value.maxPromptChars) || value.maxPromptChars < 1
  ) {
    throw new Error("Invalid Claude adapter settings in config/claude.json")
  }
  return {
    enabled: value.enabled,
    maxPromptChars: Math.min(value.maxPromptChars, ROUTING_THRESHOLDS.maxRequestChars),
  }
}

const CLAUDE_CONFIG = loadClaudeConfig(claudeConfigJson)
const API_KEY = process.env.TYPESAFE_API_KEY
const MAX_REQUEST_CHARS = CLAUDE_CONFIG.maxPromptChars
const SECRET_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]|authorization:\s*bearer\s+/i

function outputContext(context) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: context,
    },
  })}\n`)
}

async function main() {
  let raw = ""
  for await (const chunk of process.stdin) raw += chunk
  const input = JSON.parse(raw)
  const prompt = typeof input.prompt === "string" ? input.prompt : ""
  if (!prompt.trim() || prompt.length > MAX_REQUEST_CHARS || /```/.test(prompt) || SECRET_PATTERN.test(prompt)) return
  if (!CLAUDE_CONFIG.enabled) return
  const override = /^\s*@jev:(trivial|fast|normal|deep|critical)\b/i.exec(prompt)
  if (override) {
    const mode = override[1].toUpperCase()
    outputContext(`Jev advisory route: general/general/${mode} (explicit override). This is a recommendation only; Claude Code's model is not switched by this hook.`)
    return
  }
  if (!API_KEY) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1_500)
  try {
    const response = await requestJev({
      state: { request: prompt },
      model: "jev-latest",
      questions: buildRoutingQuestions(),
    }, API_KEY, controller.signal)
    const payload = await response.json().catch(() => undefined)
    if (!response.ok) return
    const answers = payload?.answers
    const modeChoice = answers?.task_mode?.choice
    if (!["TRIVIAL", "FAST", "NORMAL", "DEEP", "CRITICAL"].includes(modeChoice)) return
    const confidence = answers.task_mode.confidence
    let mode = "NORMAL"
    if (modeChoice === "DEEP" || modeChoice === "CRITICAL") mode = modeChoice
    else if (modeChoice === "TRIVIAL" && typeof confidence === "number" && confidence >= ROUTING_THRESHOLDS.trivialConfidence) {
      mode = "TRIVIAL"
    } else if (modeChoice === "FAST" && typeof confidence === "number" && confidence >= ROUTING_THRESHOLDS.fastConfidence) {
      mode = "FAST"
    }
    const roleAnswer = answers?.alm_role
    const role = ALM_ROLE_CRITERIA[roleAnswer?.choice] && typeof roleAnswer.confidence === "number" && roleAnswer.confidence >= ROUTING_THRESHOLDS.roleConfidence
      ? roleAnswer.choice
      : "general"
    const workTypes = ["implementation", "documentation", "planning", "verification", "review", "investigation", "delivery", "general"]
    const workAnswer = answers?.work_type
    const work = workTypes.includes(workAnswer?.choice) && typeof workAnswer.confidence === "number" && workAnswer.confidence >= ROUTING_THRESHOLDS.workConfidence
      ? workAnswer.choice
      : "general"
    outputContext(`Jev advisory route: ${role}/${work}/${mode}. This is a recommendation only; Claude Code's model is not switched by this hook. Continue using the configured Claude model unless the user explicitly changes it.`)
  } finally {
    clearTimeout(timer)
  }
}

main().catch(() => {})
