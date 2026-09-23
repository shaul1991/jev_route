export const ROUTING_THRESHOLDS = {
  trivialConfidence: 0.95,
  fastConfidence: 0.9,
  roleConfidence: 0.6,
  workConfidence: 0.6,
  maxRequestChars: 2_000,
}

export const ALM_ROLE_CRITERIA = {
  development: "Engineer responsible for a codebase, its current behavior, and its technical source of truth.",
  product_planning: "Product manager or planner responsible for requirements, priorities, user outcomes, and product source-of-truth documents.",
  architecture: "Architect responsible for system boundaries, technical direction, interfaces, and durable design records.",
  quality_assurance: "Quality engineer responsible for acceptance criteria, regressions, verification, and defect prevention.",
  operations_delivery: "Operations or delivery engineer responsible for build, CI, deployment, runtime configuration, and release execution.",
  governance_risk: "Security, compliance, or governance owner responsible for risk controls, permissions, and policy evidence.",
  analysis_research: "Analyst or researcher responsible for evidence gathering, option comparison, and explanatory analysis.",
  general: "The responsible ALM role is not clear from the request.",
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
