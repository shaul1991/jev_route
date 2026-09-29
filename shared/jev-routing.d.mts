export const ROUTING_THRESHOLDS: {
  trivialConfidence: number
  fastConfidence: number
  roleConfidence: number
  workConfidence: number
  specialtyConfidence: number
  maxRequestChars: number
}
export const ALM_ROLE_CRITERIA: Record<string, string>
export const SPECIALTY_CRITERIA: Record<string, string>
export function readSpecialty(answers: unknown): { specialty: string; confidence?: number }
export function specialtyAdvice(specialty: string): string
export function buildRoutingQuestions(): Record<string, unknown>
