#!/usr/bin/env node
import { createInterface } from "node:readline"
import { existsSync } from "node:fs"

const sharedPath = existsSync(new URL("../shared/jev-api.mjs", import.meta.url)) ? "../shared/" : "../../shared/"
const { requestJev } = await import(new URL(`${sharedPath}jev-api.mjs`, import.meta.url))
const { ALM_ROLE_CRITERIA, buildRoutingQuestions, ROUTING_THRESHOLDS } = await import(new URL(`${sharedPath}jev-routing.mjs`, import.meta.url))

const SECRET_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]|authorization:\s*bearer\s+/i
const MODES = ["TRIVIAL", "FAST", "NORMAL", "DEEP", "CRITICAL"]
const WORK_TYPES = ["implementation", "documentation", "planning", "verification", "review", "investigation", "delivery", "general"]

function routeAdvice(role, work, mode, source = "Jev") {
  const agent = `jev-${mode.toLowerCase()}`
  return {
    status: "classified",
    source,
    role,
    work,
    mode,
    recommendedAgent: agent,
    advisory: `Recommended Cursor subagent: ${agent}. Delegate the actual task only when it benefits from delegation; otherwise work in the parent session. This does not switch the parent model or force delegation.`,
  }
}

async function classify(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) return { status: "skipped", reason: "empty prompt" }
  if (prompt.length > ROUTING_THRESHOLDS.maxRequestChars) return { status: "skipped", reason: "prompt exceeds the shared size limit" }
  if (/```/.test(prompt)) return { status: "skipped", reason: "code block detected" }
  if (SECRET_PATTERN.test(prompt)) return { status: "skipped", reason: "secret-like content detected" }
  const override = /^\s*@jev:(trivial|fast|normal|deep|critical)\b/i.exec(prompt)
  if (override) return routeAdvice("general", "general", override[1].toUpperCase(), "explicit override")
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) return { status: "unavailable", reason: "TYPESAFE_API_KEY is not set" }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1_500)
  try {
    const response = await requestJev({
      state: { request: prompt },
      model: "jev-latest",
      questions: buildRoutingQuestions(),
    }, apiKey, controller.signal)
    const payload = await response.json().catch(() => undefined)
    if (!response.ok) return { status: "unavailable", reason: `Jev returned HTTP ${response.status}` }
    const answers = payload?.answers
    const choice = answers?.task_mode?.choice
    if (!MODES.includes(choice)) return { status: "unavailable", reason: "Jev returned no recognized task mode" }
    const confidence = answers.task_mode.confidence
    let mode = "NORMAL"
    if (choice === "DEEP" || choice === "CRITICAL") mode = choice
    else if (choice === "TRIVIAL" && typeof confidence === "number" && confidence >= ROUTING_THRESHOLDS.trivialConfidence) mode = "TRIVIAL"
    else if (choice === "FAST" && typeof confidence === "number" && confidence >= ROUTING_THRESHOLDS.fastConfidence) mode = "FAST"
    const roleAnswer = answers?.alm_role
    const role = ALM_ROLE_CRITERIA[roleAnswer?.choice] && typeof roleAnswer.confidence === "number" && roleAnswer.confidence >= ROUTING_THRESHOLDS.roleConfidence
      ? roleAnswer.choice
      : "general"
    const workAnswer = answers?.work_type
    const work = WORK_TYPES.includes(workAnswer?.choice) && typeof workAnswer.confidence === "number" && workAnswer.confidence >= ROUTING_THRESHOLDS.workConfidence
      ? workAnswer.choice
      : "general"
    return routeAdvice(role, work, mode)
  } catch {
    return { status: "unavailable", reason: "Jev request failed or timed out" }
  } finally {
    clearTimeout(timer)
  }
}

function respond(id, result, error) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) })}\n`)
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of input) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    continue
  }
  if (message.method === "notifications/initialized" || message.method?.startsWith("notifications/")) continue
  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "jev-router", version: "0.1.0" },
    })
  } else if (message.method === "ping") {
    respond(message.id, {})
  } else if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "classify_task",
        description: "Classify the user's current request into ALM role, work type, and one of five advisory task modes.",
        inputSchema: {
          type: "object",
          properties: { prompt: { type: "string", description: "The user's current request to classify." } },
          required: ["prompt"],
          additionalProperties: false,
        },
      }],
    })
  } else if (message.method === "tools/call") {
    if (message.params?.name !== "classify_task") {
      respond(message.id, undefined, { code: -32602, message: "Unknown tool" })
      continue
    }
    const result = await classify(message.params.arguments?.prompt)
    respond(message.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: result.status === "unavailable",
    })
  } else if (message.id !== undefined) {
    respond(message.id, undefined, { code: -32601, message: "Method not found" })
  }
}
