export const ROUTING_THRESHOLDS = {
  trivialConfidence: 0.95,
  fastConfidence: 0.9,
  roleConfidence: 0.6,
  workConfidence: 0.6,
  specialtyConfidence: 0.6,
  maxRequestChars: 2_000,
}

export const ALM_ROLE_CRITERIA = {
  development: "Engineer responsible for a codebase, its current behavior, and its technical source of truth.",
  product_planning: "Product manager or planner responsible for problems, requirements, priorities, user outcomes, acceptance criteria, and product source-of-truth documents. Not detailed screen or interaction design.",
  product_design: "Product or UX/UI designer responsible for user flows, information architecture, screens and their states, interaction, visual direction, responsive behavior, and accessibility of the user interface.",
  architecture: "Architect responsible for system boundaries, technical direction, interfaces, data contracts, and durable design records. Not user interface or visual design.",
  quality_assurance: "Quality engineer responsible for acceptance criteria, regressions, verification, and defect prevention.",
  operations_delivery: "Operations or delivery engineer responsible for build, CI, deployment, runtime configuration, release execution, production maintenance and incidents, and retiring or decommissioning a system.",
  governance_risk: "Security, compliance, or governance owner responsible for risk controls, permissions, and policy evidence.",
  analysis_research: "Analyst or researcher responsible for evidence gathering, option comparison, and explanatory analysis.",
  general: "The responsible ALM role is not clear from the request.",
}

export const SPECIALTY_CRITERIA = {
  web_frontend: "Browser UI implementation: component structure, client state, rendering performance, SEO, browser compatibility, or accessibility implementation.",
  mobile_app: "Native or cross-platform mobile app: OS permissions, offline behavior, push notifications, app lifecycle, or app store release.",
  backend_api: "Server-side services or APIs: request contracts, authentication integration, background jobs, external integrations, idempotency, or error models.",
  data_database: "Databases and stored data: schema changes, data migrations, indexes and query performance, backup and restore, or data retention.",
  infrastructure_platform: "Infrastructure and platform: hosting, networking, domains and certificates, CI/CD pipelines, scaling, or cloud cost.",
  none: "No single technical specialty needs dedicated expert checks, or the request is not about building or operating software.",
}

const SPECIALTY_CHECKS = {
  web_frontend: "component boundaries, accessibility implementation, responsive behavior, and loading and bundle performance",
  mobile_app: "platform guidelines, OS permissions, app lifecycle and offline states, and store review and version compatibility",
  backend_api: "contract compatibility, idempotency, error model, and retry and timeout behavior",
  data_database: "migration reversibility, data integrity, query performance, backup and restore, and retention or deletion rules",
  infrastructure_platform: "reproducible configuration, cost limits, failure isolation, and recovery time",
}

/** Returns the specialty only when Jev chose a known option with enough confidence; otherwise "none". */
export function readSpecialty(answers) {
  const answer = answers?.specialty
  const confidence = typeof answer?.confidence === "number" ? answer.confidence : undefined
  const known = typeof answer?.choice === "string" && Object.hasOwn(SPECIALTY_CRITERIA, answer.choice)
  const specialty = known && confidence !== undefined && confidence >= ROUTING_THRESHOLDS.specialtyConfidence
    ? answer.choice
    : "none"
  return { specialty, confidence }
}

export function specialtyAdvice(specialty) {
  const checks = Object.hasOwn(SPECIALTY_CHECKS, specialty) ? SPECIALTY_CHECKS[specialty] : undefined
  if (!checks) return ""
  return `Specialist focus: ${specialty}. Before completing the work, apply these checks: ${checks}. This is a checklist hint for the current or delegated agent, not a separate route, model switch, or approval.`
}

export function buildRoutingQuestions() {
  return {
    alm_role: {
      type: "choice",
      instructions: "Which ALM role owns the source of truth and primary accountability for this request? Choose the role before considering the work artifact.",
      criteria: ALM_ROLE_CRITERIA,
    },
    work_type: {
      type: "choice",
      instructions: "What is the primary work artifact or activity in this request? This is independent of the ALM role that owns it.",
      criteria: {
        design: "Create or refine a visual design, UI/UX concept, layout, or design artifact. Not system architecture, database design, or ordinary code maintenance.",
        implementation: "Change executable code, configuration, infrastructure, or other implemented behavior.",
        documentation: "Create or update a durable document, specification, explanation, or source-of-truth record.",
        planning: "Define requirements, priorities, milestones, decisions, or an execution plan.",
        verification: "Test, validate, reproduce, or establish acceptance evidence.",
        review: "Inspect an existing artifact for quality, correctness, risk, or policy conformance.",
        investigation: "Diagnose, research, explain, compare, or find the cause of an issue.",
        delivery: "Build, package, release, deploy, or operate a delivered system.",
        general: "No single work artifact or activity is clear.",
      },
    },
    specialty: {
      type: "choice",
      instructions: "Which technical specialty, if any, needs dedicated expert checks for this request? Choose none unless the request clearly centers on one specialty's risks. This is independent of the ALM role and work type.",
      criteria: SPECIALTY_CRITERIA,
    },
    task_mode: {
      type: "choice",
      instructions: "Which of five implementation depths is appropriate for this request? Select depth from the request itself; platform-specific policy floors may raise the applied route.",
      criteria: {
        TRIVIAL: "Read-only or tiny, immediately reversible work with no meaningful external effects or risk.",
        FAST: "A localized, obvious, low-risk change with a narrow scope and simple verification.",
        NORMAL: "A bounded ordinary implementation or feature requiring standard analysis and verification.",
        DEEP: "An unknown root cause, multi-file design, migration, concurrency, public contract, or other substantial technical risk.",
        CRITICAL: "Authentication or authorization boundaries, payment or sensitive data, production operations, credentials, or irreversible high-impact changes.",
      },
    },
  }
}
