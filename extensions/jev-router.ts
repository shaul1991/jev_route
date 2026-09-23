import { mkdir, open, readFile, writeFile } from "node:fs/promises"
import { requestJev } from "../shared/jev-api.mjs"
import { ALM_ROLE_CRITERIA, buildRoutingQuestions, ROUTING_THRESHOLDS } from "../shared/jev-routing.mjs"
import ompConfigJson from "../config/omp.json" with { type: "json" }

const ROUTER_MODE_ENV = "JEV_ROUTER_MODE"
const API_KEY_ENV = "TYPESAFE_API_KEY"
const JEV_MODEL = "jev-latest"
const REQUEST_TIMEOUT_MS = 1_500
const FAST_CONFIDENCE_MIN = ROUTING_THRESHOLDS.fastConfidence
const ROLE_CONFIDENCE_MIN = ROUTING_THRESHOLDS.roleConfidence
const WORK_CONFIDENCE_MIN = ROUTING_THRESHOLDS.workConfidence
const POLICY_MATCH_MIN = 0.8
const MAX_REQUEST_CHARS = ROUTING_THRESHOLDS.maxRequestChars
const MAX_APPROVED_POLICIES = 8
const AUDIT_SAMPLE_RATE = 0.1
// Named OMP profiles expose their own agent root here; keep telemetry isolated by profile.
const STATE_DIR = process.env.PI_CODING_AGENT_DIR ?? `${process.env.HOME ?? ""}/.omp/agent`
const LOG_PATH = `${STATE_DIR}/jev-router.decisions.jsonl`
const POLICY_PATH = `${STATE_DIR}/jev-router.policies.json`
const AUDIT_LOG_PATH = `${STATE_DIR}/jev-router.audits.jsonl`
const TOOL_RISK_MODE_ENV = "JEV_TOOL_RISK_MODE"
const TOOL_RISK_LOG_PATH = `${STATE_DIR}/jev-tool-risk.audits.jsonl`
const REQUEST_PREVIEW_CHARS = 160
const LOG_TAIL_DEFAULT = 10
const LOG_TAIL_MAX = 50

type Mode = "TRIVIAL" | "FAST" | "NORMAL" | "DEEP" | "CRITICAL"
type RouterMode = "off" | "observe" | "active"
type DecisionSource = "auto" | "override" | "fallback"
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
type NotifyLevel = "info" | "warning" | "error"
type PolicyStatus = "candidate" | "approved"
type AuditLabel = "UNDER_ROUTED" | "CORRECT" | "OVER_ROUTED" | "INCONCLUSIVE"
type AuditCategory =
  | "persistence_schema"
  | "auth_permissions"
  | "payment_sensitive"
  | "concurrency_transaction"
  | "public_contract"
  | "broad_refactor"
  | "unknown"

type ToolRiskMode = "off" | "observe"
type ToolRiskLevel = "safe" | "guarded" | "destructive" | "external" | "credential"
type ToolRiskSource = "jev" | "local"

type AlmRole =
  | "development"
  | "product_planning"
  | "architecture"
  | "quality_assurance"
  | "operations_delivery"
  | "governance_risk"
  | "analysis_research"
  | "general"

type WorkType =
  | "implementation"
  | "documentation"
  | "planning"
  | "verification"
  | "review"
  | "investigation"
  | "delivery"
  | "general"

type Route = {
  roles: string[]
  thinking: ThinkingLevel
}

type AlmWorkRoute = {
  light: string[]
  deep: string[]
}

type AlmRoleRoute = {
  tasks: Partial<Record<WorkType, AlmWorkRoute>>
  fallback: AlmWorkRoute
}

type OmpRouterConfig = {
  version: 1
  defaultRole: string
  trivialRoles: string[]
  criticalPrimaryRole: string
  tierRolesByMode: Record<Mode, string>
  fallbackRolesByMode: Record<Mode, string[]>
  thinkingByMode: Record<Mode, ThinkingLevel>
  routes: Record<AlmRole, AlmRoleRoute>
}

type Decision = {
  mode: Mode
  almRole: AlmRole
  workType: WorkType
  source: DecisionSource
  baseMode?: Mode
  policyIds?: string[]
  confidence?: number
  roleConfidence?: number
  workConfidence?: number
  jevModel?: string
  latencyMs?: number
  inputTokens?: number
  fallbackReason?: string
}

type RoutingPolicy = {
  id: string
  status: PolicyStatus
  minMode: Mode
  condition: string
  reason: string
  evidenceCount: number
  lastReviewed?: string
}

type PolicyStore = {
  version: 1
  policies: RoutingPolicy[]
}

type AuditDecision = {
  label: AuditLabel
  confidence?: number
  category: AuditCategory
  categoryConfidence?: number
  jevModel?: string
  latencyMs?: number
  inputTokens?: number
}

/** 사용자 요청을 감사 로그에 남기기 위한 최소 표현. 비밀값이 의심되면 본문 없이 길이만 남긴다. */
type RequestTrace = {
  preview?: string
  chars: number
  redacted: boolean
}

/** 이 턴에 실제로(또는 observe 모드에서는 계획상) 배정된 OMP 모델. */
type AppliedRoute = {
  modelRole?: string
  model: string
  thinking: ThinkingLevel
}

type AuditRun = {
  request: string
  trace: RequestTrace
  route?: AppliedRoute
  routerMode: RouterMode
  decision: Decision
  applied: boolean
  toolCalls: number
  writeToolCalls: number
  toolErrors: number
  retries: number
  compactions: number
}

/** 원문 명령을 외부로 보내지 않는 observe-only Tool Risk Gate의 최소 입력·판정 형태. */
type ToolRiskObservation = {
  toolName: "bash"
  commandChars: number
  signals: string[]
  hasPossibleSecret: boolean
}

type ToolRiskDecision = {
  level: ToolRiskLevel
  confidence?: number
  confirmationProbability?: number
  source: ToolRiskSource
  jevModel?: string
  latencyMs?: number
  inputTokens?: number
  fallbackReason?: string
}

type TurnState = {
  model: unknown
  thinking: ThinkingLevel
} | null

type ModelQuery = {
  resolve?: (selector: string) => unknown
}

type ExtensionContext = {
  model: unknown
  models?: ModelQuery
  ui: {
    notify: (message: string, level: NotifyLevel) => void
    setStatus: (key: string, value: string) => void
  }
}

type ExtensionAPI = {
  getThinkingLevel: () => ThinkingLevel
  on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>) => void
  registerCommand: (name: string, command: {
    description: string
    handler: (args: string, ctx: ExtensionContext) => void | Promise<void>
  }) => void
  setModel: (model: unknown) => Promise<boolean>
  setThinkingLevel: (level: ThinkingLevel) => void
}

const MODE_NAMES: Mode[] = ["TRIVIAL", "FAST", "NORMAL", "DEEP", "CRITICAL"]
const ALM_ROLE_NAMES = Object.keys(ALM_ROLE_CRITERIA) as AlmRole[]
const WORK_TYPE_NAMES: WorkType[] = [
  "implementation", "documentation", "planning", "verification",
  "review", "investigation", "delivery", "general",
]

function parseOmpRouterConfig(value: unknown): OmpRouterConfig {
  const invalid = (): never => {
    throw new Error("Invalid OMP adapter settings in config/omp.json")
  }
  const root = asRecord(value)
  if (root?.version !== 1) return invalid()

  const isAlias = (candidate: unknown): candidate is string =>
    typeof candidate === "string" && /^@[A-Za-z0-9_-]{1,64}$/.test(candidate)
  const parseAliases = (candidate: unknown, allowEmpty = false): string[] => {
    if (!Array.isArray(candidate) || (!allowEmpty && candidate.length === 0) || candidate.length > 12) return invalid()
    if (!candidate.every(isAlias)) return invalid()
    return candidate.slice()
  }
  const parseWorkRoute = (candidate: unknown): AlmWorkRoute => {
    const route = asRecord(candidate)
    if (!route) return invalid()
    return {
      light: parseAliases(route.light),
      deep: parseAliases(route.deep),
    }
  }

  if (!isAlias(root.defaultRole) || !isAlias(root.criticalPrimaryRole)) return invalid()
  const rawTierRoles = asRecord(root.tierRolesByMode)
  if (!rawTierRoles || Object.keys(rawTierRoles).length !== MODE_NAMES.length) return invalid()
  const tierRolesByMode = {} as Record<Mode, string>
  for (const mode of MODE_NAMES) {
    if (!isAlias(rawTierRoles[mode])) return invalid()
    tierRolesByMode[mode] = rawTierRoles[mode]
  }
  const trivialRoles = parseAliases(root.trivialRoles)
  const rawFallbacks = asRecord(root.fallbackRolesByMode)
  if (!rawFallbacks || Object.keys(rawFallbacks).length !== MODE_NAMES.length) return invalid()
  const fallbackRolesByMode = {} as Record<Mode, string[]>
  for (const mode of MODE_NAMES) {
    fallbackRolesByMode[mode] = parseAliases(rawFallbacks[mode], true)
  }
  const rawThinking = asRecord(root.thinkingByMode)
  const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
  if (!rawThinking) return invalid()
  const thinkingByMode = {} as Record<Mode, ThinkingLevel>
  for (const mode of MODE_NAMES) {
    const level = rawThinking[mode]
    if (typeof level !== "string" || !thinkingLevels.includes(level)) return invalid()
    thinkingByMode[mode] = level as ThinkingLevel
  }

  const rawRoutes = asRecord(root.routes)
  if (!rawRoutes || Object.keys(rawRoutes).length !== ALM_ROLE_NAMES.length) return invalid()
  const routes = {} as Record<AlmRole, AlmRoleRoute>
  for (const almRole of ALM_ROLE_NAMES) {
    const roleRoute = asRecord(rawRoutes[almRole])
    const rawTasks = asRecord(roleRoute?.tasks)
    if (!roleRoute || !rawTasks) return invalid()
    const tasks: Partial<Record<WorkType, AlmWorkRoute>> = {}
    for (const [workType, route] of Object.entries(rawTasks)) {
      if (!WORK_TYPE_NAMES.includes(workType as WorkType)) return invalid()
      tasks[workType as WorkType] = parseWorkRoute(route)
    }
    routes[almRole] = { tasks, fallback: parseWorkRoute(roleRoute.fallback) }
  }
  return {
    version: 1,
    defaultRole: root.defaultRole,
    trivialRoles,
    criticalPrimaryRole: root.criticalPrimaryRole,
    tierRolesByMode,
    fallbackRolesByMode,
    thinkingByMode,
    routes,
  }
}

const OMP_CONFIG = parseOmpRouterConfig(ompConfigJson)
const ALM_ROUTES = OMP_CONFIG.routes

function candidateRoles(workRoute: AlmWorkRoute, mode: Mode): string[] {
  let configured: string[]
  switch (mode) {
    case "TRIVIAL":
      configured = OMP_CONFIG.trivialRoles
      break
    case "FAST":
    case "NORMAL":
      configured = workRoute.light
      break
    case "DEEP":
      configured = workRoute.deep
      break
    case "CRITICAL":
      configured = [OMP_CONFIG.criticalPrimaryRole, ...workRoute.deep]
      break
  }
  return [
    ...new Set([
      OMP_CONFIG.tierRolesByMode[mode],
      ...configured,
      ...OMP_CONFIG.fallbackRolesByMode[mode],
      OMP_CONFIG.defaultRole,
    ]),
  ]
}

function routeFor(almRole: AlmRole, workType: WorkType, mode: Mode): Route {
  const roleRoute = ALM_ROUTES[almRole]
  const workRoute = roleRoute.tasks[workType] ?? roleRoute.fallback
  return { roles: candidateRoles(workRoute, mode), thinking: OMP_CONFIG.thinkingByMode[mode] }
}

const MODE_RANK: Record<Mode, number> = {
  TRIVIAL: 0,
  FAST: 1,
  NORMAL: 2,
  DEEP: 3,
  CRITICAL: 4,
}

const CORRECTION_TEMPLATES: Record<Exclude<AuditCategory, "unknown">, Omit<RoutingPolicy, "id" | "status" | "evidenceCount" | "lastReviewed">> = {
  persistence_schema: {
    minMode: "NORMAL",
    condition: "The request changes a database migration, persistent-data schema, or stored-data representation.",
    reason: "Schema and persistent-data changes need at least normal implementation and verification.",
  },
  auth_permissions: {
    minMode: "CRITICAL",
    condition: "The request changes authentication, authorization, permissions, identity, or access control.",
    reason: "Identity and authorization changes require the highest-risk routing path.",
  },
  payment_sensitive: {
    minMode: "CRITICAL",
    condition: "The request changes payments, financial amounts, secrets, credentials, or sensitive-data handling.",
    reason: "Financial and sensitive-data changes require the highest-risk routing path.",
  },
  concurrency_transaction: {
    minMode: "DEEP",
    condition: "The request changes concurrency, locking, retries, idempotency, transactions, or consistency behavior.",
    reason: "Concurrency and transaction changes require root-cause and failure-mode analysis.",
  },
  public_contract: {
    minMode: "DEEP",
    condition: "The request changes a public API, externally consumed schema, compatibility contract, or its callers.",
    reason: "Public contract changes require compatibility analysis across callers.",
  },
  broad_refactor: {
    minMode: "DEEP",
    condition: "The request requires broad repository analysis, cross-cutting refactoring, or an unknown root-cause investigation.",
    reason: "Broad or ambiguous changes require deeper repository analysis.",
  },
}

let activeTurn: TurnState = null
let activeAudit: AuditRun | null = null

function configuredMode(): RouterMode {
  const value = process.env[ROUTER_MODE_ENV]?.toLowerCase()
  if (value === "active" || value === "observe" || value === "off") return value
  return "observe"
}

function configuredToolRiskMode(): ToolRiskMode {
  const value = process.env[TOOL_RISK_MODE_ENV]?.toLowerCase()
  return value === "off" ? "off" : "observe"
}

/**
 * bash 원문·경로·인자값은 Jev에 전송하지 않는다. 실행 형태만 로컬 정규식으로 표지한다.
 * 표지가 없는 명령은 이 observe 단계의 비용을 들일 가치가 없어 기록·호출 모두 생략한다.
 */
function observeBashRisk(event: unknown): ToolRiskObservation | undefined {
  const record = asRecord(event)
  if (record?.toolName !== "bash") return undefined
  const input = asRecord(record.input)
  const command = typeof input?.command === "string" ? input.command : undefined
  if (!command) return undefined

  const signals: string[] = []
  if (/\b(?:rm|rmdir|unlink)\b|\bgit\s+(?:clean|reset)\b|\b(?:drop|truncate)\b/i.test(command)) {
    signals.push("destructive_local_change")
  }
  if (/\bgit\s+push\b|\b(?:npm|pnpm|yarn|bun)\s+publish\b|\b(?:docker|podman)\s+push\b|\bgh\s+(?:pr\s+merge|release\s+create)\b/i.test(command)) {
    signals.push("external_mutation")
  }
  if (/\b(?:curl|wget|scp|rsync|ssh)\b/i.test(command)) signals.push("network_transfer")
  if (/\bsudo\b|\bchmod\b|\bchown\b|\bkill(?:all)?\b/i.test(command)) signals.push("privileged_or_process_control")
  if (/\b(?:docker|podman)\s+(?:system\s+prune|volume\s+prune)\b|\bcompose\s+down\b[^\n]*\s-v\b/i.test(command)) {
    signals.push("infrastructure_data_removal")
  }
  const hasPossibleSecret = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]|authorization:\s*bearer\s+/i.test(command)
  if (hasPossibleSecret) signals.push("possible_secret")
  if (signals.length === 0) return undefined
  return { toolName: "bash", commandChars: command.length, signals, hasPossibleSecret }
}

function parseOverride(prompt: string): { mode?: Mode; prompt: string } {
  const match = /^\s*@jev:(auto|trivial|fast|normal|deep|critical)\b\s*/i.exec(prompt)
  if (!match) return { prompt }

  const promptWithoutPrefix = prompt.slice(match[0].length)
  const requestedMode = match[1].toUpperCase()
  if (requestedMode === "TRIVIAL" || requestedMode === "FAST" || requestedMode === "NORMAL" || requestedMode === "DEEP" || requestedMode === "CRITICAL") {
    return { mode: requestedMode, prompt: promptWithoutPrefix }
  }
  return { prompt: promptWithoutPrefix }
}

function outboundBlockReason(prompt: string, images: unknown): string | undefined {
  if (Array.isArray(images) && images.length > 0) return "attachment_present"
  if (!prompt.trim()) return "empty_prompt"
  if (prompt.length > MAX_REQUEST_CHARS) return "request_too_long"
  if (/```/.test(prompt)) return "code_block_present"
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]|authorization:\s*bearer\s+/i.test(prompt)) {
    return "possible_secret"
  }
  return undefined
}

/**
 * 로컬 모니터링 로그에 남길 요청 표현을 만든다. 비밀값이 의심되는 요청(`possible_secret`)은
 * 본문을 남기지 않고 길이만 기록한다 — 로그는 0600이지만 평문 시크릿을 디스크에 복제하지 않는다.
 */
function requestTrace(prompt: string, blockReason?: string): RequestTrace {
  const chars = prompt.length
  if (blockReason === "possible_secret") return { chars, redacted: true }
  const collapsed = prompt.replace(/\s+/g, " ").trim()
  if (!collapsed) return { chars, redacted: false }
  const preview = collapsed.length > REQUEST_PREVIEW_CHARS
    ? `${collapsed.slice(0, REQUEST_PREVIEW_CHARS)}…`
    : collapsed
  return { preview, chars, redacted: false }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function asMode(value: unknown): Mode | undefined {
  return value === "TRIVIAL" || value === "FAST" || value === "NORMAL" || value === "DEEP" || value === "CRITICAL" ? value : undefined
}

function asPolicyStatus(value: unknown): PolicyStatus | undefined {
  return value === "candidate" || value === "approved" ? value : undefined
}

function asAuditLabel(value: unknown): AuditLabel | undefined {
  return value === "UNDER_ROUTED" || value === "CORRECT" || value === "OVER_ROUTED" || value === "INCONCLUSIVE"
    ? value
    : undefined
}

function asAuditCategory(value: unknown): AuditCategory | undefined {
  return value === "persistence_schema"
    || value === "auth_permissions"
    || value === "payment_sensitive"
    || value === "concurrency_transaction"
    || value === "public_contract"
    || value === "broad_refactor"
    || value === "unknown"
    ? value
    : undefined
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined
}

function boundedCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000
    ? value
    : undefined
}

function moreConservative(left: Mode, right: Mode): Mode {
  return MODE_RANK[left] >= MODE_RANK[right] ? left : right
}

function emptyPolicyStore(): PolicyStore {
  return { version: 1, policies: [] }
}

function parsePolicyStore(value: unknown): PolicyStore | undefined {
  const root = asRecord(value)
  if (root?.version !== 1 || !Array.isArray(root.policies)) return undefined

  const policies: RoutingPolicy[] = []
  for (const candidate of root.policies.slice(0, MAX_APPROVED_POLICIES * 3)) {
    const record = asRecord(candidate)
    const id = boundedString(record?.id, 80)
    const status = asPolicyStatus(record?.status)
    const minMode = asMode(record?.minMode)
    const condition = boundedString(record?.condition, 500)
    const reason = boundedString(record?.reason, 500)
    const evidenceCount = boundedCount(record?.evidenceCount)
    const lastReviewed = record?.lastReviewed === undefined ? undefined : boundedString(record.lastReviewed, 64)
    if (!id || !/^[a-z0-9_-]+$/.test(id) || !status || !minMode || !condition || !reason || evidenceCount === undefined) {
      continue
    }
    policies.push({ id, status, minMode, condition, reason, evidenceCount, lastReviewed })
  }
  return { version: 1, policies }
}

async function persistPolicyStore(store: PolicyStore): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  await writeFile(POLICY_PATH, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
}

async function loadPolicyStore(): Promise<PolicyStore> {
  try {
    const parsed = parsePolicyStore(JSON.parse(await readFile(POLICY_PATH, "utf8")) as unknown)
    return parsed ?? emptyPolicyStore()
  } catch (error) {
    if (asRecord(error)?.code !== "ENOENT") return emptyPolicyStore()
    const store = emptyPolicyStore()
    try {
      await persistPolicyStore(store)
    } catch {
      // A missing policy file must never prevent routing.
    }
    return store
  }
}

function approvedPolicies(store: PolicyStore): RoutingPolicy[] {
  return store.policies
    .filter(policy => policy.status === "approved")
    .slice(0, MAX_APPROVED_POLICIES)
}

type RouteResponse = {
  modeChoice: unknown
  modeConfidence: unknown
  roleChoice: unknown
  roleConfidence: unknown
  workChoice: unknown
  workConfidence: unknown
  policyProbabilities: Record<string, number>
  model?: string
  inputTokens?: number
}

function readRouteResponse(payload: unknown, policies: RoutingPolicy[]): RouteResponse {
  const response = asRecord(payload)
  const answers = asRecord(response?.answers)
  const taskMode = asRecord(answers?.task_mode)
  const almRole = asRecord(answers?.alm_role)
  const workType = asRecord(answers?.work_type)
  const usage = asRecord(response?.usage)
  const policyProbabilities: Record<string, number> = {}

  for (let index = 0; index < policies.length; index++) {
    const answer = asRecord(answers?.[`policy_${index}`])
    if (typeof answer?.noul === "number") policyProbabilities[policies[index].id] = answer.noul
  }

  return {
    modeChoice: taskMode?.choice,
    modeConfidence: taskMode?.confidence,
    roleChoice: almRole?.choice,
    roleConfidence: almRole?.confidence,
    workChoice: workType?.choice,
    workConfidence: workType?.confidence,
    policyProbabilities,
    model: typeof response?.model === "string" ? response.model : undefined,
    inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
  }
}

function readChoiceAnswer(payload: unknown, id: string): {
  choice: unknown
  confidence: unknown
  model?: string
  inputTokens?: number
} {
  const response = asRecord(payload)
  const answers = asRecord(response?.answers)
  const answer = asRecord(answers?.[id])
  const usage = asRecord(response?.usage)
  return {
    choice: answer?.choice,
    confidence: answer?.confidence,
    model: typeof response?.model === "string" ? response.model : undefined,
    inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
  }
}

function decideMode(choice: unknown, confidence: unknown): Mode | undefined {
  if (choice !== "TRIVIAL" && choice !== "FAST" && choice !== "NORMAL" && choice !== "DEEP" && choice !== "CRITICAL") return undefined
  if (choice === "TRIVIAL" && typeof confidence === "number" && confidence >= ROUTING_THRESHOLDS.trivialConfidence) return "TRIVIAL"
  if (choice === "FAST" && typeof confidence === "number" && confidence >= FAST_CONFIDENCE_MIN) return "FAST"
  if (choice === "DEEP" || choice === "CRITICAL") return choice
  return "NORMAL"
}

function asAlmRole(value: unknown): AlmRole | undefined {
  return value === "development"
    || value === "product_planning"
    || value === "architecture"
    || value === "quality_assurance"
    || value === "operations_delivery"
    || value === "governance_risk"
    || value === "analysis_research"
    || value === "general"
    ? value
    : undefined
}

function asWorkType(value: unknown): WorkType | undefined {
  return value === "implementation"
    || value === "documentation"
    || value === "planning"
    || value === "verification"
    || value === "review"
    || value === "investigation"
    || value === "delivery"
    || value === "general"
    ? value
    : undefined
}

async function queryJev(prompt: string): Promise<Decision> {
  const policyStore = await loadPolicyStore()
  const policies = approvedPolicies(policyStore)
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const questions: Record<string, unknown> = buildRoutingQuestions()

  for (let index = 0; index < policies.length; index++) {
    const policy = policies[index]
    questions[`policy_${index}`] = {
      type: "noul",
      instructions: `Does \`request\` satisfy this approved routing policy? ${policy.condition}`,
      criteria: {
        true: `The request satisfies the policy and must be routed at least ${policy.minMode}.`,
        false: "The request does not satisfy the policy.",
      },
    }
  }

  try {
    const response = await requestJev({
      state: { request: prompt },
      model: JEV_MODEL,
      questions,
    }, process.env[API_KEY_ENV], controller.signal)

    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) throw new Error(`http_${response.status}`)

    const answer = readRouteResponse(payload, policies)
    const baseMode = decideMode(answer.modeChoice, answer.modeConfidence)
    if (!baseMode) throw new Error("invalid_response")

    const matchedPolicies = policies.filter(policy => answer.policyProbabilities[policy.id] >= POLICY_MATCH_MIN)
    const mode = matchedPolicies.reduce((selected, policy) => moreConservative(selected, policy.minMode), baseMode)
    const role = asAlmRole(answer.roleChoice)
    const work = asWorkType(answer.workChoice)
    return {
      mode,
      almRole: role && typeof answer.roleConfidence === "number" && answer.roleConfidence >= ROLE_CONFIDENCE_MIN
        ? role
        : "general",
      workType: work && typeof answer.workConfidence === "number" && answer.workConfidence >= WORK_CONFIDENCE_MIN
        ? work
        : "general",
      baseMode,
      policyIds: matchedPolicies.map(policy => policy.id),
      source: "auto",
      confidence: typeof answer.modeConfidence === "number" ? answer.modeConfidence : undefined,
      roleConfidence: typeof answer.roleConfidence === "number" ? answer.roleConfidence : undefined,
      workConfidence: typeof answer.workConfidence === "number" ? answer.workConfidence : undefined,
      jevModel: answer.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: answer.inputTokens,
    }
  } finally {
    clearTimeout(timer)
  }
}

function localToolRisk(observation: ToolRiskObservation, reason: string): ToolRiskDecision {
  const level = observation.hasPossibleSecret
    ? "credential"
    : observation.signals.includes("external_mutation") || observation.signals.includes("network_transfer")
      ? "external"
      : observation.signals.includes("destructive_local_change") || observation.signals.includes("infrastructure_data_removal")
        ? "destructive"
        : "guarded"
  return { level, source: "local", fallbackReason: reason }
}

async function queryToolRisk(observation: ToolRiskObservation): Promise<ToolRiskDecision> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await requestJev({
      // Never send the command, paths, argument values, or file contents. Only locally-derived signals.
      state: {
        tool: observation.toolName,
        command_chars: observation.commandChars,
        risk_signals: observation.signals,
      },
      model: JEV_MODEL,
      questions: {
        risk_level: {
          type: "choice",
          instructions: "Classify the risk of this tool operation from its tool type and locally-derived risk signals. Do not infer unprovided command details.",
          criteria: {
            safe: "Read-only or reversible local operation without meaningful external, destructive, privileged, or credential risk.",
            guarded: "Local operation needs ordinary review but is not destructive, credential-related, or an external side effect.",
            destructive: "May delete, irreversibly rewrite, or remove local or infrastructure data.",
            external: "May send data to, publish to, mutate, or control an external system or network endpoint.",
            credential: "May expose, manipulate, or contain secrets, credentials, tokens, or private keys.",
          },
        },
        requires_confirmation: {
          type: "noul",
          instructions: "Would this operation normally require explicit human confirmation before execution in a developer harness?",
          criteria: {
            true: "Destructive, externally mutating, privileged, or credential-sensitive operation.",
            false: "Read-only or ordinary reversible local operation.",
          },
        },
      },
    }, process.env[API_KEY_ENV], controller.signal)
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) throw new Error(`http_${response.status}`)
    const level = readChoiceAnswer(payload, "risk_level")
    const confirmation = asRecord(asRecord(asRecord(payload)?.answers)?.requires_confirmation)
    const selected = asToolRiskLevel(level.choice)
    if (!selected) throw new Error("invalid_tool_risk_response")
    return {
      level: selected,
      confidence: typeof level.confidence === "number" ? level.confidence : undefined,
      confirmationProbability: typeof confirmation?.noul === "number" ? confirmation.noul : undefined,
      source: "jev",
      jevModel: level.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: level.inputTokens,
    }
  } finally {
    clearTimeout(timer)
  }
}

function asToolRiskLevel(value: unknown): ToolRiskLevel | undefined {
  return value === "safe" || value === "guarded" || value === "destructive" || value === "external" || value === "credential"
    ? value
    : undefined
}
function countBucket(count: number): "0" | "1" | "2-3" | "4+" {
  if (count === 0) return "0"
  if (count === 1) return "1"
  if (count <= 3) return "2-3"
  return "4+"
}

function auditState(run: AuditRun): Record<string, unknown> {
  return {
    alm_role: run.decision.almRole,
    work_type: run.decision.workType,
    selected_mode: run.decision.mode,
    base_mode: run.decision.baseMode,
    policy_memory_applied: run.decision.policyIds ?? [],
    execution: {
      tool_calls: countBucket(run.toolCalls),
      write_tool_calls: countBucket(run.writeToolCalls),
      tool_errors: countBucket(run.toolErrors),
      automatic_retries: countBucket(run.retries),
      automatic_compactions: countBucket(run.compactions),
    },
  }
}

async function queryAudit(run: AuditRun): Promise<AuditDecision> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await requestJev({
      state: {
        request: run.request,
        audit: auditState(run),
      },
      model: JEV_MODEL,
      questions: {
        route_audit: {
          type: "choice",
          instructions: "Assess the selected implementation route using only `request` and `audit`. Do not infer source-code facts that are absent.",
          criteria: {
            UNDER_ROUTED: "The request or execution outcome indicates the selected mode was too low and a more capable route was warranted.",
            CORRECT: "The request and execution outcome support the selected mode as appropriate.",
            OVER_ROUTED: "The request and execution outcome support a lower mode as sufficient.",
            INCONCLUSIVE: "The available request and outcome signals do not establish whether the selected mode was appropriate.",
          },
        },
        correction_category: {
          type: "choice",
          instructions: "If a routing correction is warranted, which single category best describes it? Return unknown unless the category is explicit in `request`.",
          criteria: {
            persistence_schema: "Database migrations, persistent-data schema, or stored-data representation.",
            auth_permissions: "Authentication, authorization, permissions, identity, or access control.",
            payment_sensitive: "Payments, financial amounts, credentials, secrets, or sensitive-data handling.",
            concurrency_transaction: "Concurrency, locking, retries, idempotency, transactions, or consistency.",
            public_contract: "Public API, externally consumed schema, compatibility, or caller contract.",
            broad_refactor: "Broad cross-cutting refactor, repository-wide analysis, or unknown root-cause investigation.",
            unknown: "No category is explicit enough to record.",
          },
        },
      },
    }, process.env[API_KEY_ENV], controller.signal)

    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) throw new Error(`http_${response.status}`)

    const routeAudit = readChoiceAnswer(payload, "route_audit")
    const category = readChoiceAnswer(payload, "correction_category")
    const label = asAuditLabel(routeAudit.choice)
    const auditCategory = asAuditCategory(category.choice)
    if (!label || !auditCategory) throw new Error("invalid_audit_response")
    return {
      label,
      confidence: typeof routeAudit.confidence === "number" ? routeAudit.confidence : undefined,
      category: auditCategory,
      categoryConfidence: typeof category.confidence === "number" ? category.confidence : undefined,
      jevModel: routeAudit.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: routeAudit.inputTokens,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function appendJsonLine(path: string, record: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
    const file = await open(path, "a", 0o600)
    try {
      await file.writeFile(`${JSON.stringify(record)}\n`)
    } finally {
      await file.close()
    }
  } catch {
    // Optional telemetry must never block the active agent.
  }
}

async function logDecision(
  decision: Decision,
  routerMode: RouterMode,
  applied: boolean,
  trace?: RequestTrace,
  route?: AppliedRoute,
): Promise<void> {
  await appendJsonLine(LOG_PATH, {
    timestamp: new Date().toISOString(),
    router_mode: routerMode,
    source: decision.source,
    alm_role: decision.almRole,
    work_type: decision.workType,
    selected_mode: decision.mode,
    base_mode: decision.baseMode,
    policy_ids: decision.policyIds,
    applied,
    request_preview: trace?.preview,
    request_chars: trace?.chars,
    request_redacted: trace?.redacted === true ? true : undefined,
    model_role: route?.modelRole,
    model: route?.model,
    thinking: route?.thinking,
    confidence: decision.confidence,
    role_confidence: decision.roleConfidence,
    work_confidence: decision.workConfidence,
    jev_model: decision.jevModel,
    latency_ms: decision.latencyMs,
    input_tokens: decision.inputTokens,
    fallback_reason: decision.fallbackReason,
  })
}

async function logAudit(run: AuditRun, audit?: AuditDecision, auditError?: string, candidateId?: string): Promise<void> {
  await appendJsonLine(AUDIT_LOG_PATH, {
    timestamp: new Date().toISOString(),
    router_mode: run.routerMode,
    source: run.decision.source,
    alm_role: run.decision.almRole,
    work_type: run.decision.workType,
    selected_mode: run.decision.mode,
    base_mode: run.decision.baseMode,
    policy_ids: run.decision.policyIds,
    applied: run.applied,
    request_preview: run.trace.preview,
    request_chars: run.trace.chars,
    request_redacted: run.trace.redacted === true ? true : undefined,
    model_role: run.route?.modelRole,
    model: run.route?.model,
    thinking: run.route?.thinking,
    ...auditState(run),
    audit_source: audit ? "jev" : "none",
    audit_label: audit?.label,
    audit_confidence: audit?.confidence,
    audit_category: audit?.category,
    audit_category_confidence: audit?.categoryConfidence,
    audit_model: audit?.jevModel,
    audit_latency_ms: audit?.latencyMs,
    audit_input_tokens: audit?.inputTokens,
    candidate_policy_id: candidateId,
    audit_error: auditError,
  })
}

async function logToolRisk(observation: ToolRiskObservation, decision: ToolRiskDecision): Promise<void> {
  await appendJsonLine(TOOL_RISK_LOG_PATH, {
    timestamp: new Date().toISOString(),
    mode: "observe",
    enforced: false,
    tool: observation.toolName,
    command_chars: observation.commandChars,
    risk_signals: observation.signals,
    risk_level: decision.level,
    confidence: decision.confidence,
    confirmation_probability: decision.confirmationProbability,
    recommended_action: decision.level === "safe" ? "allow" : "would_confirm",
    source: decision.source,
    jev_model: decision.jevModel,
    latency_ms: decision.latencyMs,
    input_tokens: decision.inputTokens,
    fallback_reason: decision.fallbackReason,
  })
}

/**
 * Observe-only: 이 비동기 작업은 tool_call 결과를 반환하지 않아 실제 실행을 지연·수정·차단하지 않는다.
 * Jev 장애·시크릿 가능성은 로컬 판정으로만 기록한다.
 */
async function observeToolRisk(event: unknown): Promise<void> {
  try {
    if (configuredToolRiskMode() === "off") return
    const observation = observeBashRisk(event)
    if (!observation) return
    if (observation.hasPossibleSecret) {
      await logToolRisk(observation, localToolRisk(observation, "possible_secret_not_sent"))
      return
    }
    if (!process.env[API_KEY_ENV]) {
      await logToolRisk(observation, localToolRisk(observation, "api_key_missing"))
      return
    }
    try {
      await logToolRisk(observation, await queryToolRisk(observation))
    } catch (error) {
      await logToolRisk(
        observation,
        localToolRisk(observation, error instanceof Error ? error.message : "unknown_error"),
      )
    }
  } catch {
    // Observability must never interfere with the underlying tool call.
  }
}

function candidateIdFor(category: Exclude<AuditCategory, "unknown">): string {
  return `${category}-under-route`
}

async function recordCandidate(category: AuditCategory): Promise<string | undefined> {
  if (category === "unknown") return undefined
  const template = CORRECTION_TEMPLATES[category]
  const id = candidateIdFor(category)
  const store = await loadPolicyStore()
  const existing = store.policies.find(policy => policy.id === id)
  const now = new Date().toISOString()

  if (existing) {
    if (existing.status !== "candidate") return existing.id
    existing.evidenceCount = Math.min(existing.evidenceCount + 1, 1_000)
    existing.lastReviewed = now
  } else {
    store.policies.push({
      id,
      status: "candidate",
      minMode: template.minMode,
      condition: template.condition,
      reason: template.reason,
      evidenceCount: 1,
      lastReviewed: now,
    })
  }

  await persistPolicyStore(store)
  return id
}

async function promoteCandidate(id: string): Promise<"promoted" | "not_found" | "not_ready" | "already_approved"> {
  const store = await loadPolicyStore()
  const policy = store.policies.find(candidate => candidate.id === id)
  if (!policy) return "not_found"
  if (policy.status === "approved") return "already_approved"
  if (policy.evidenceCount < 2) return "not_ready"
  policy.status = "approved"
  policy.lastReviewed = new Date().toISOString()
  await persistPolicyStore(store)
  return "promoted"
}

function shouldAudit(run: AuditRun): boolean {
  if (run.routerMode !== "active" || !run.applied || run.decision.source !== "auto") return false
  return run.decision.mode === "TRIVIAL" || run.decision.mode === "FAST"
    || run.toolErrors > 0
    || run.retries > 0
    || run.compactions > 0
    || Math.random() < AUDIT_SAMPLE_RATE
}

async function auditCompletedRun(run: AuditRun, ctx: ExtensionContext): Promise<void> {
  if (!shouldAudit(run)) return
  try {
    const audit = await queryAudit(run)
    const candidateId = audit.label === "UNDER_ROUTED"
      ? await recordCandidate(audit.category)
      : undefined
    await logAudit(run, audit, undefined, candidateId)
    if (candidateId) {
      report(ctx, `Jev audit recorded correction candidate: ${candidateId}`, "warning")
    }
  } catch (error) {
    await logAudit(run, undefined, error instanceof Error ? error.message : "unknown_error")
  }
}

function takeActiveAudit(): AuditRun | null {
  const run = activeAudit
  activeAudit = null
  return run
}

function recordToolStart(event: unknown): void {
  if (!activeAudit) return
  const toolName = asRecord(event)?.toolName
  if (typeof toolName !== "string") return
  activeAudit.toolCalls++
  if (toolName === "edit" || toolName === "write" || toolName === "ast_edit") activeAudit.writeToolCalls++
}

function recordToolEnd(event: unknown): void {
  if (!activeAudit) return
  if (asRecord(event)?.isError === true) activeAudit.toolErrors++
}

function updateStatus(ctx: ExtensionContext, status: string): void {
  try {
    ctx.ui.setStatus("jev-router", status)
  } catch {
    // UI feedback is optional and must not interrupt routing.
  }
}

type RouteSelection = {
  role: string
  model: unknown
}

function resolveRole(ctx: ExtensionContext, role: string): RouteSelection | undefined {
  try {
    const model = ctx.models?.resolve?.(role)
    return model ? { role, model } : undefined
  } catch {
    return undefined
  }
}

function resolveRoute(ctx: ExtensionContext, route: Route): RouteSelection | undefined {
  for (const role of route.roles) {
    const selection = resolveRole(ctx, role)
    if (selection) return selection
  }
  return undefined
}

function modelLabel(model: unknown): string {
  const record = asRecord(model)
  const provider = typeof record?.provider === "string" ? record.provider : undefined
  const id = typeof record?.id === "string" ? record.id : undefined
  return provider && id ? `${provider}/${id}` : "unresolved"
}

function routeLabel(route: Route, selection?: RouteSelection): string {
  const role = selection?.role ?? route.roles[0] ?? OMP_CONFIG.defaultRole
  return `${role} (${modelLabel(selection?.model)}):${route.thinking}`
}

/** 모니터링 로그용 배정 결과. observe 모드에서는 "적용됐다면 썼을" 라우트를 뜻한다. */
function appliedRoute(route: Route, selection?: RouteSelection): AppliedRoute {
  return {
    modelRole: selection?.role ?? route.roles[0],
    model: modelLabel(selection?.model),
    thinking: route.thinking,
  }
}

async function selectRoute(pi: ExtensionAPI, ctx: ExtensionContext, route: Route): Promise<RouteSelection | undefined> {
  for (const role of route.roles) {
    const selection = resolveRole(ctx, role)
    if (!selection) continue
    try {
      if (!await pi.setModel(selection.model)) continue
      pi.setThinkingLevel(route.thinking)
      return selection
    } catch {
      // An unavailable candidate must not prevent trying later roles.
    }
  }
  return undefined
}

async function applyDecision(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  decision: Decision,
): Promise<{ applied: boolean; route: AppliedRoute }> {
  activeTurn = {
    model: ctx.model,
    thinking: pi.getThinkingLevel(),
  }

  const route = routeFor(decision.almRole, decision.workType, decision.mode)
  const selection = await selectRoute(pi, ctx, route)
  if (selection) {
    const policySuffix = decision.policyIds && decision.policyIds.length > 0
      ? `; policy ${decision.policyIds.join(",")}`
      : ""
    updateStatus(ctx, `Jev ${decision.almRole}/${decision.workType}/${decision.mode} → ${routeLabel(route, selection)}${policySuffix}`)
    return { applied: true, route: appliedRoute(route, selection) }
  }

  activeTurn = null
  updateStatus(ctx, "Jev ALM role route unavailable; keeping current model")
  return { applied: false, route: appliedRoute(route) }
}

async function restoreTurn(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const previous = activeTurn
  activeTurn = null
  if (!previous) return

  try {
    if (previous.model) await pi.setModel(previous.model)
    pi.setThinkingLevel(previous.thinking)
    updateStatus(ctx, "Jev router ready")
  } catch {
    updateStatus(ctx, "Jev route ended; original model restoration failed")
  }
}

function report(ctx: ExtensionContext, message: string, level: NotifyLevel = "info"): void {
  try {
    ctx.ui.notify(message, level)
  } catch {
    // Notifications are optional UI feedback.
  }
}

async function reportPolicyStatus(ctx: ExtensionContext): Promise<void> {
  const store = await loadPolicyStore()
  const approved = store.policies.filter(policy => policy.status === "approved")
  const candidates = store.policies.filter(policy => policy.status === "candidate")
  const ids = candidates.slice(0, 3).map(policy => `${policy.id}:${policy.evidenceCount}`).join(", ")
  report(
    ctx,
    `Jev policy memory: ${approved.length} approved, ${candidates.length} candidate${ids ? ` (${ids})` : ""}`,
  )
}

type RoleCoverage = {
  primaryRoutes: number
  fallbackRoutes: number
}

/**
 * Jev 경로가 참조하는 OMP 역할과 우선순위를 한곳에서 계산한다.
 * 새 provider를 특정 역할에 배정한 뒤 이 목록을 보면 그 모델의 실제 선택 범위를 확인할 수 있다.
 */
function collectRoleCoverage(): Record<string, RoleCoverage> {
  const coverage: Record<string, RoleCoverage> = {}
  for (const roleRoute of Object.values(ALM_ROUTES)) {
    const routes = [...Object.values(roleRoute.tasks), roleRoute.fallback]
    for (const route of routes) {
      for (const mode of MODE_NAMES) {
        const candidates = candidateRoles(route, mode)
        for (let index = 0; index < candidates.length; index++) {
          const role = candidates[index].slice(1)
          const entry = coverage[role] ?? { primaryRoutes: 0, fallbackRoutes: 0 }
          if (index === 0) entry.primaryRoutes++
          else entry.fallbackRoutes++
          coverage[role] = entry
        }
      }
    }
  }
  return coverage
}

function routeCandidates(ctx: ExtensionContext, route: AlmWorkRoute): string {
  return MODE_NAMES.map(mode => {
    const roles = candidateRoles(route, mode)
    const resolved = resolveRoute(ctx, { roles, thinking: OMP_CONFIG.thinkingByMode[mode] })
    const target = resolved
      ? `${resolved.role} = ${modelLabel(resolved.model)}`
      : "no available model; current model retained"
    return `${mode} ${roles.join(" → ")} [first resolved: ${target}; thinking ${OMP_CONFIG.thinkingByMode[mode]}]`
  }).join("; ")
}

/** `/jev roles` — Jev 경로가 실제 OMP 모델 역할로 resolve되는지와 영향 범위를 보여준다. */
function reportRoleCoverage(ctx: ExtensionContext, includeRoutes: boolean): void {
  const coverage = collectRoleCoverage()
  const lines = ["Jev role coverage — change `modelRoles` first, then rerun this command."]
  for (const [role, usage] of Object.entries(coverage).sort(([left], [right]) => left.localeCompare(right))) {
    const resolved = resolveRole(ctx, `@${role}`)
    const state = resolved ? modelLabel(resolved.model) : "MISSING"
    lines.push(
      `@${role.padEnd(13)} ${state} — primary ${usage.primaryRoutes}, fallback ${usage.fallbackRoutes}`,
    )
  }
  if (includeRoutes) {
    lines.push("\nJev classification → candidates")
    for (const [almRole, roleRoute] of Object.entries(ALM_ROUTES)) {
      for (const [workType, route] of Object.entries(roleRoute.tasks)) {
        lines.push(`${almRole}/${workType}: ${routeCandidates(ctx, route)}`)
      }
      lines.push(`${almRole}/fallback: ${routeCandidates(ctx, roleRoute.fallback)}`)
    }
  }
  lines.push("\nUse `/jev <request>` to classify one request and see its selected model. `/jev log` shows applied history.")
  report(ctx, lines.join("\n"))
}

type LogRow = {
  timestamp?: string
  requestPreview?: string
  requestChars?: number
  requestRedacted: boolean
  routerMode?: string
  source?: string
  almRole?: string
  workType?: string
  mode?: string
  confidence?: number
  applied: boolean
  modelRole?: string
  model?: string
  thinking?: string
  auditLabel?: string
  fallbackReason?: string
}

function readLogRow(line: string): LogRow | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  const record = asRecord(parsed)
  if (!record) return undefined
  const text = (key: string): string | undefined =>
    typeof record[key] === "string" ? record[key] as string : undefined
  const num = (key: string): number | undefined =>
    typeof record[key] === "number" ? record[key] as number : undefined
  return {
    timestamp: text("timestamp"),
    requestPreview: text("request_preview"),
    requestChars: num("request_chars"),
    requestRedacted: record.request_redacted === true,
    routerMode: text("router_mode"),
    source: text("source"),
    almRole: text("alm_role"),
    workType: text("work_type"),
    mode: text("selected_mode"),
    confidence: num("confidence"),
    applied: record.applied === true,
    modelRole: text("model_role"),
    model: text("model"),
    thinking: text("thinking"),
    auditLabel: text("audit_label"),
    fallbackReason: text("fallback_reason"),
  }
}

async function tailLogRows(path: string, limit: number): Promise<LogRow[]> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch {
    return []
  }
  const rows: LogRow[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    const row = readLogRow(line)
    if (row) rows.push(row)
  }
  return rows.slice(-limit)
}

function formatLogRow(row: LogRow): string {
  const time = row.timestamp ? row.timestamp.slice(11, 19) : "--:--:--"
  const judgement = `${row.almRole ?? "?"}/${row.workType ?? "?"}/${row.mode ?? "?"}`
  const confidence = row.confidence === undefined ? "" : ` ${row.confidence.toFixed(2)}`
  const target = row.model && row.model !== "unresolved"
    ? `${row.model}:${row.thinking ?? "?"}`
    : `${row.modelRole ?? "?"} (unresolved)`
  const applied = row.applied ? "applied" : `not-applied${row.routerMode === "observe" ? " (observe)" : ""}`
  const why = row.source === "auto" ? "" : ` [${row.source ?? "?"}${row.fallbackReason ? `:${row.fallbackReason}` : ""}]`
  const request = row.requestRedacted
    ? `<redacted ${row.requestChars ?? 0} chars>`
    : row.requestPreview ?? "<no request recorded>"
  const audit = row.auditLabel ? ` audit ${row.auditLabel}` : ""
  return `${time} ${judgement}${confidence}${why} → ${target} (${applied})${audit}\n    "${request}"`
}

/** `/jev log [n]` — 최근 라우팅 결정을 요청·판단·배정 모델까지 한 줄씩 보여준다. */
async function reportDecisionLog(ctx: ExtensionContext, limitArg: string): Promise<void> {
  const requested = Number.parseInt(limitArg, 10)
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, LOG_TAIL_MAX)
    : LOG_TAIL_DEFAULT
  const [decisions, audits] = await Promise.all([
    tailLogRows(LOG_PATH, limit),
    tailLogRows(AUDIT_LOG_PATH, limit),
  ])
  if (decisions.length === 0 && audits.length === 0) {
    report(ctx, "Jev log: no routing decisions recorded yet", "warning")
    return
  }
  const sections = [`Jev routing log (last ${decisions.length}) — ${LOG_PATH}`]
  sections.push(decisions.map(formatLogRow).join("\n"))
  if (audits.length > 0) {
    sections.push(`Jev audit log (last ${audits.length}) — ${AUDIT_LOG_PATH}`)
    sections.push(audits.map(formatLogRow).join("\n"))
  }
  report(ctx, sections.join("\n"))
}

/** `/jev risk` — observe-only 위험 gate의 설정과 최근 분류를 원문 명령 없이 보여준다. */
async function reportToolRisk(ctx: ExtensionContext): Promise<void> {
  let raw: string
  try {
    raw = await readFile(TOOL_RISK_LOG_PATH, "utf8")
  } catch {
    report(
      ctx,
      `Jev Tool Risk Gate: ${configuredToolRiskMode()} only; no risk observations yet — ${TOOL_RISK_LOG_PATH}`,
    )
    return
  }
  const lines = [
    `Jev Tool Risk Gate: ${configuredToolRiskMode()} only; never blocks or modifies execution.`,
    `Scope: bash calls with destructive/external/credential/privilege signals; raw commands are never sent to Jev or logged.`,
  ]
  for (const line of raw.trim().split("\n").slice(-LOG_TAIL_DEFAULT)) {
    let value: Record<string, unknown> | undefined
    try {
      value = asRecord(JSON.parse(line))
    } catch {
      continue
    }
    if (!value) continue
    const timestamp = typeof value.timestamp === "string" ? value.timestamp.slice(11, 19) : "--:--:--"
    const signals = Array.isArray(value.risk_signals) ? value.risk_signals.join(",") : "?"
    const risk = typeof value.risk_level === "string" ? value.risk_level : "?"
    const confidence = typeof value.confidence === "number" ? ` ${value.confidence.toFixed(2)}` : ""
    const source = typeof value.source === "string" ? value.source : "?"
    lines.push(`${timestamp} bash ${signals} → ${risk}${confidence} (${source}; observe-only)`)
  }
  report(ctx, lines.join("\n"))
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("jev", {
    description: "Classify with Jev; inspect routes, roles, and observe-only tool risk",
    handler: async (args, ctx) => {
      const request = args.trim()
      if (!request || request === "status" || request === "routes") {
        const keyState = process.env[API_KEY_ENV] ? "present" : "missing"
        report(
          ctx,
          `Jev router: ${configuredMode()}; API key ${keyState}\nALM role → work type → OMP model role; TRIVIAL:minimal, FAST:low, NORMAL:medium, DEEP:high, CRITICAL:xhigh\n\`/jev roles\` audits assigned models; \`/jev roles routes\` prints all five tier mappings; \`/jev log [n]\` shows routing history; \`/jev risk\` shows observe-only bash risk telemetry.`,
        )
        return
      }

      if (request === "policy" || request === "policy status") {
        await reportPolicyStatus(ctx)
        return
      }

      const logTail = /^log(?:\s+(\d+))?$/i.exec(request)
      if (logTail) {
        await reportDecisionLog(ctx, logTail[1] ?? "")
        return
      }

      if (request === "risk" || request === "risk status") {
        await reportToolRisk(ctx)
        return
      }

      if (request === "roles" || request === "roles status") {
        reportRoleCoverage(ctx, false)
        return
      }

      if (request === "roles routes") {
        reportRoleCoverage(ctx, true)
        return
      }

      const promote = /^policy\s+promote\s+([a-z0-9_-]+)$/i.exec(request)
      if (promote) {
        try {
          const outcome = await promoteCandidate(promote[1])
          if (outcome === "promoted") {
            report(ctx, `Jev policy approved: ${promote[1]}`)
          } else if (outcome === "not_ready") {
            report(ctx, `Jev policy needs two audit observations before approval: ${promote[1]}`, "warning")
          } else if (outcome === "already_approved") {
            report(ctx, `Jev policy is already approved: ${promote[1]}`)
          } else {
            report(ctx, `Jev policy candidate not found: ${promote[1]}`, "warning")
          }
        } catch {
          report(ctx, "Jev policy memory could not be updated", "error")
        }
        return
      }

      const blocked = outboundBlockReason(request, [])
      if (blocked) {
        report(ctx, `Jev request not sent: ${blocked}`, "warning")
        return
      }
      if (!process.env[API_KEY_ENV]) {
        report(ctx, "Jev API key is not configured", "error")
        return
      }

      try {
        const decision = await queryJev(request)
        const route = routeFor(decision.almRole, decision.workType, decision.mode)
        const selection = resolveRoute(ctx, route)
        void logDecision(
          decision,
          configuredMode(),
          false,
          requestTrace(request, blocked),
          appliedRoute(route, selection),
        )
        const policies = decision.policyIds && decision.policyIds.length > 0
          ? `; policy ${decision.policyIds.join(",")}`
          : ""
        report(
          ctx,
          `Jev ${decision.almRole}/${decision.workType}/${decision.mode} → ${routeLabel(route, selection)} (${decision.confidence?.toFixed(2) ?? "n/a"}, ${decision.latencyMs} ms${policies})`,
        )
      } catch (error) {
        report(ctx, `Jev request failed: ${error instanceof Error ? error.message : "unknown_error"}`, "error")
      }
    },
  })

  pi.on("before_agent_start", async (event, ctx) => {
    activeAudit = null
    const routerMode = configuredMode()
    if (routerMode === "off") return

    const requestEvent = asRecord(event)
    const parsed = parseOverride(typeof requestEvent?.prompt === "string" ? requestEvent.prompt : "")
    let decision: Decision
    let blocked: string | undefined

    if (parsed.mode) {
      decision = { mode: parsed.mode, almRole: "general", workType: "general", source: "override" }
    } else {
      blocked = outboundBlockReason(parsed.prompt, requestEvent?.images)
      if (blocked || !process.env[API_KEY_ENV]) {
        decision = {
          mode: "NORMAL",
          almRole: "general",
          workType: "general",
          source: "fallback",
          fallbackReason: blocked ?? "api_key_missing",
        }
      } else {
        try {
          decision = await queryJev(parsed.prompt)
        } catch (error) {
          decision = {
            mode: "NORMAL",
            almRole: "general",
            workType: "general",
            source: "fallback",
            fallbackReason: error instanceof Error ? error.message : "unknown_error",
          }
        }
      }
    }

    const trace = requestTrace(parsed.prompt, blocked)

    if (routerMode === "observe") {
      const plannedRoute = routeFor(decision.almRole, decision.workType, decision.mode)
      const planned = appliedRoute(plannedRoute, resolveRoute(ctx, plannedRoute))
      updateStatus(ctx, `Jev ${decision.almRole}/${decision.workType}/${decision.mode} (${decision.source}; observe)`)
      void logDecision(decision, routerMode, false, trace, planned)
      return
    }

    const { applied, route } = await applyDecision(pi, ctx, decision)
    activeAudit = {
      request: parsed.prompt,
      trace,
      route,
      routerMode,
      decision,
      applied,
      toolCalls: 0,
      writeToolCalls: 0,
      toolErrors: 0,
      retries: 0,
      compactions: 0,
    }
    void logDecision(decision, routerMode, applied, trace, route)
  })

  pi.on("tool_call", event => {
    // Intentionally no return/await: observe-only must not alter tool execution or approval.
    void observeToolRisk(event)
  })

  pi.on("tool_execution_start", event => {
    recordToolStart(event)
  })

  pi.on("tool_execution_end", event => {
    recordToolEnd(event)
  })

  pi.on("auto_retry_start", () => {
    if (activeAudit) activeAudit.retries++
  })

  pi.on("auto_compaction_start", () => {
    if (activeAudit) activeAudit.compactions++
  })

  pi.on("agent_end", async (event, ctx) => {
    if (asRecord(event)?.willContinue === true) return
    const run = takeActiveAudit()
    await restoreTurn(pi, ctx)
    if (run) void auditCompletedRun(run, ctx)
  })

  pi.on("agent_settled", async (_event, ctx) => {
    const run = takeActiveAudit()
    await restoreTurn(pi, ctx)
    if (run) void auditCompletedRun(run, ctx)
  })

  pi.on("session_shutdown", async (_event, ctx) => {
    const run = takeActiveAudit()
    await restoreTurn(pi, ctx)
    if (run) void auditCompletedRun(run, ctx)
  })
}
