#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"

const bundled = existsSync(new URL("./shared/jev-api.mjs", import.meta.url))
const shared = bundled ? "./shared/" : "../shared/"
const settingsPath = bundled ? "./config/hermes.json" : "../config/hermes.json"
const { requestJev } = await import(new URL(`${shared}jev-api.mjs`, import.meta.url))
const { ALM_ROLE_CRITERIA, buildRoutingQuestions, ROUTING_THRESHOLDS } = await import(new URL(`${shared}jev-routing.mjs`, import.meta.url))
const settings = JSON.parse(readFileSync(new URL(settingsPath, import.meta.url), "utf8"))
const MODES = ["TRIVIAL", "FAST", "NORMAL", "DEEP", "CRITICAL"]
const WORK_TYPES = ["implementation", "documentation", "planning", "verification", "review", "investigation", "delivery", "general"]
const SECRET_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]|authorization:\s*bearer\s+/i

function classified(role, work, mode) {
  return { status: "classified", role, work, mode }
}

async function route() {
  if (settings.version !== 1 || typeof settings.enabled !== "boolean" || !Number.isInteger(settings.maxPromptChars) || settings.maxPromptChars < 1) return
  if (!settings.enabled) return
  let raw = ""
  for await (const chunk of process.stdin) raw += chunk
  const prompt = JSON.parse(raw)?.prompt
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > Math.min(settings.maxPromptChars, ROUTING_THRESHOLDS.maxRequestChars) || /```/.test(prompt) || SECRET_PATTERN.test(prompt)) return
  const override = /^\s*@jev:(trivial|fast|normal|deep|critical)\b/i.exec(prompt)
  if (override) return classified("general", "general", override[1].toUpperCase())
  if (!process.env.TYPESAFE_API_KEY) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1_500)
  try {
    const response = await requestJev({ state: { request: prompt }, model: "jev-latest", questions: buildRoutingQuestions() }, process.env.TYPESAFE_API_KEY, controller.signal)
    if (!response.ok) return
    const answers = (await response.json())?.answers
    const choice = answers?.task_mode?.choice
    if (!MODES.includes(choice)) return
    const confidence = answers.task_mode.confidence
    let mode = "NORMAL"
    if (choice === "DEEP" || choice === "CRITICAL") mode = choice
    else if (choice === "TRIVIAL" && typeof confidence === "number" && confidence >= ROUTING_THRESHOLDS.trivialConfidence) mode = "TRIVIAL"
    else if (choice === "FAST" && typeof confidence === "number" && confidence >= ROUTING_THRESHOLDS.fastConfidence) mode = "FAST"
    const roleAnswer = answers?.alm_role
    const role = ALM_ROLE_CRITERIA[roleAnswer?.choice] && typeof roleAnswer.confidence === "number" && roleAnswer.confidence >= ROUTING_THRESHOLDS.roleConfidence ? roleAnswer.choice : "general"
    const workAnswer = answers?.work_type
    const work = WORK_TYPES.includes(workAnswer?.choice) && typeof workAnswer.confidence === "number" && workAnswer.confidence >= ROUTING_THRESHOLDS.workConfidence ? workAnswer.choice : "general"
    return classified(role, work, mode)
  } finally {
    clearTimeout(timer)
  }
}

route().then(value => { if (value) process.stdout.write(`${JSON.stringify(value)}\n`) }).catch(() => {})
