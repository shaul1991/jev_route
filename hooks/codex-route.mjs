#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { requestJev } from "../shared/jev-api.mjs"
import { ALM_ROLE_CRITERIA, buildRoutingQuestions, ROUTING_THRESHOLDS } from "../shared/jev-routing.mjs"

const config = JSON.parse(readFileSync(new URL("../config/codex.json", import.meta.url), "utf8"))
if (config.version !== 1 || typeof config.enabled !== "boolean" || !Number.isInteger(config.maxPromptChars) || config.maxPromptChars < 1) {
  throw new Error("Invalid Codex adapter settings in config/codex.json")
}
const maxChars = Math.min(config.maxPromptChars, ROUTING_THRESHOLDS.maxRequestChars)
const secretPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]|authorization:\s*bearer\s+/i
const modes = ["TRIVIAL", "FAST", "NORMAL", "DEEP", "CRITICAL"]

function outputAdvice(role, work, mode) {
  const agent = `jev_${mode.toLowerCase()}`
  const context = `Jev advisory route: ${role}/${work}/${mode}. Recommended Codex custom subagent: ${agent}. If the task benefits from delegation, spawn this agent with the user's actual task; otherwise work in the parent session. The subagent has its own configured model. This hook does not switch the parent model or force delegation, and is not a security boundary.`
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } })}\n`)
}

async function main() {
  if (!config.enabled) return
  let raw = ""
  for await (const chunk of process.stdin) raw += chunk
  const input = JSON.parse(raw)
  const prompt = typeof input.prompt === "string" ? input.prompt : ""
  if (!prompt.trim() || prompt.length > maxChars || /```/.test(prompt) || secretPattern.test(prompt)) return
  const override = /^\s*@jev:(trivial|fast|normal|deep|critical)\b/i.exec(prompt)
  if (override) {
    outputAdvice("general", "general", override[1].toUpperCase())
    return
  }
  if (!process.env.TYPESAFE_API_KEY) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1_500)
  try {
    const response = await requestJev({
      state: { request: prompt },
      model: "jev-latest",
      questions: buildRoutingQuestions(),
    }, process.env.TYPESAFE_API_KEY, controller.signal)
    const payload = await response.json().catch(() => undefined)
    if (!response.ok) return
    const answers = payload?.answers
    const choice = answers?.task_mode?.choice
    if (!modes.includes(choice)) return
    const confidence = answers.task_mode.confidence
    let mode = "NORMAL"
    if (choice === "DEEP" || choice === "CRITICAL") mode = choice
    else if (choice === "TRIVIAL" && typeof confidence === "number" && confidence >= ROUTING_THRESHOLDS.trivialConfidence) mode = "TRIVIAL"
    else if (choice === "FAST" && typeof confidence === "number" && confidence >= ROUTING_THRESHOLDS.fastConfidence) mode = "FAST"
    const roleAnswer = answers?.alm_role
    const role = ALM_ROLE_CRITERIA[roleAnswer?.choice] && typeof roleAnswer.confidence === "number" && roleAnswer.confidence >= ROUTING_THRESHOLDS.roleConfidence
      ? roleAnswer.choice
      : "general"
    const workTypes = ["implementation", "documentation", "planning", "verification", "review", "investigation", "delivery", "general"]
    const workAnswer = answers?.work_type
    const work = workTypes.includes(workAnswer?.choice) && typeof workAnswer.confidence === "number" && workAnswer.confidence >= ROUTING_THRESHOLDS.workConfidence
      ? workAnswer.choice
      : "general"
    outputAdvice(role, work, mode)
  } finally {
    clearTimeout(timer)
  }
}

main().catch(() => {})
