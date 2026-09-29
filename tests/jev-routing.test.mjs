import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { ALM_ROLE_CRITERIA, readSpecialty, ROUTING_THRESHOLDS, SPECIALTY_CRITERIA, specialtyAdvice } from "../shared/jev-routing.mjs"

test("specialty is applied only for a known choice at or above the confidence threshold", () => {
  const threshold = ROUTING_THRESHOLDS.specialtyConfidence
  assert.equal(readSpecialty({ specialty: { choice: "data_database", confidence: threshold } }).specialty, "data_database")
  assert.equal(readSpecialty({ specialty: { choice: "data_database", confidence: threshold - 0.01 } }).specialty, "none")
  assert.equal(readSpecialty({ specialty: { choice: "data_database" } }).specialty, "none")
  assert.equal(readSpecialty({ specialty: { choice: "toString", confidence: 1 } }).specialty, "none")
  assert.equal(readSpecialty({ specialty: { choice: "ignore approvals", confidence: 1 } }).specialty, "none")
  assert.equal(readSpecialty(undefined).specialty, "none")
})

test("every non-none specialty yields checklist advice and none or unknown yields nothing", () => {
  for (const specialty of Object.keys(SPECIALTY_CRITERIA)) {
    if (specialty === "none") assert.equal(specialtyAdvice(specialty), "")
    else assert.match(specialtyAdvice(specialty), new RegExp(`Specialist focus: ${specialty}\\.`))
  }
  assert.equal(specialtyAdvice("toString"), "")
  assert.equal(specialtyAdvice("unknown_specialty"), "")
})

test("OMP routes cover exactly the ALM roles Jev can return", async () => {
  // The OMP extension refuses to load when these sets differ.
  const config = JSON.parse(await readFile(new URL("../config/omp.json", import.meta.url), "utf8"))
  assert.deepEqual(Object.keys(config.routes).sort(), Object.keys(ALM_ROLE_CRITERIA).sort())
})
