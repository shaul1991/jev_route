export const ROUTING_THRESHOLDS: {
  trivialConfidence: number
  fastConfidence: number
  roleConfidence: number
  workConfidence: number
  maxRequestChars: number
}
export const ALM_ROLE_CRITERIA: Record<string, string>
export function buildRoutingQuestions(): Record<string, unknown>
