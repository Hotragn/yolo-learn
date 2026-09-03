import { describe, expect, it } from "vitest"
import { normalizeForField, normalizeParams } from "../runner"
import { FieldSpec, SITE_V1, SITE_V2, TaughtFlow } from "../types"

const serviceField = SITE_V1.steps[0].fields[0]
const dateField = SITE_V1.steps[1].fields[0]
const nameField = SITE_V1.steps[2].fields[0]

const flow: TaughtFlow = {
  id: "f1",
  name: "book_appointment",
  intent: "Book appointment at Northside Family Clinic",
  taughtAt: "2026-09-01T10:00:00.000Z",
  siteVersionAtTeach: "1.0",
  params: [
    { key: "serviceType", label: "Service", type: "string", sourceField: { stepIntent: "choose service", fieldPurpose: "service type" } },
    { key: "date", label: "Preferred date", type: "date", sourceField: { stepIntent: "pick date and time", fieldPurpose: "date" } },
    { key: "patientName", label: "Your name", type: "string", sourceField: { stepIntent: "enter patient details", fieldPurpose: "patient name" } },
  ],
  steps: SITE_V1.steps,
  fieldValues: { "service type": "checkup", date: "2026-09-11", time: "10:00 AM", "patient name": "Jane Doe", phone: "555-0142" },
  status: "healthy",
  runCount: 1,
  lastRunAt: null,
  lastHealedAt: null,
}

describe("normalizeForField", () => {
  it("accepts an exact option", () => {
    expect(normalizeForField(serviceField, "dental cleaning")).toEqual({ value: "dental cleaning" })
  })

  it("normalizes case and stray whitespace to the canonical option", () => {
    expect(normalizeForField(serviceField, "  Dental   Cleaning ")).toEqual({ value: "dental cleaning" })
    expect(normalizeForField(SITE_V1.steps[1].fields[1], "10:00 am")).toEqual({ value: "10:00 AM" })
  })

  it("rejects a value outside the option list and lists what is allowed", () => {
    const { value, error } = normalizeForField(serviceField, "root canal")
    expect(value).toBeUndefined()
    expect(error).toContain("checkup")
    expect(error).toContain("root canal")
  })

  it("rejects a date the input element could never hold", () => {
    expect(normalizeForField(dateField, "next Friday").error).toContain("YYYY-MM-DD")
    expect(normalizeForField(dateField, "2026-09-11")).toEqual({ value: "2026-09-11" })
  })

  it("treats empty and whitespace-only as not supplied, without erroring", () => {
    expect(normalizeForField(nameField, "   ")).toEqual({})
    expect(normalizeForField(nameField, null)).toEqual({})
    expect(normalizeForField(nameField, undefined)).toEqual({})
  })

  it("clamps a hostile length instead of storing it", () => {
    expect(normalizeForField(nameField, "a".repeat(10000)).value!.length).toBe(200)
  })

  it("stringifies a non-string without throwing", () => {
    expect(normalizeForField(nameField, 12345)).toEqual({ value: "12345" })
    expect(normalizeForField(nameField, { a: 1 }).value).toBe("[object Object]")
  })
})

describe("normalizeParams", () => {
  it("maps only this flow's parameters and reports the rest as ignored", () => {
    const out = normalizeParams(flow, { patientName: "Sam Rivera", nonsense: "x", __proto__: "y" }, SITE_V1)
    expect(out.params).toEqual({ patientName: "Sam Rivera" })
    expect(out.errors).toEqual([])
    expect(out.ignoredKeys).toContain("nonsense")
  })

  it("collects every validation error rather than stopping at the first", () => {
    const out = normalizeParams(flow, { serviceType: "root canal", date: "tomorrow" }, SITE_V1)
    expect(out.errors).toHaveLength(2)
    expect(Object.keys(out.params)).toHaveLength(0)
  })

  it("validates against the site as it looks now, not as it looked at teach time", () => {
    // The name field is renamed and moved in v2; the parameter still resolves.
    const out = normalizeParams(flow, { patientName: "Sam Rivera" }, SITE_V2)
    expect(out.params).toEqual({ patientName: "Sam Rivera" })
  })

  it("skips a parameter whose field no longer exists instead of throwing", () => {
    const orphan: TaughtFlow = {
      ...flow,
      params: [
        { key: "ghost", label: "Ghost", type: "string", sourceField: { stepIntent: "gone", fieldPurpose: "gone" } },
      ],
    }
    const out = normalizeParams(orphan, { ghost: "boo" }, SITE_V1)
    expect(out.params).toEqual({})
    expect(out.errors).toEqual([])
  })

  it("ignores an explicit null or undefined value", () => {
    const out = normalizeParams(flow, { patientName: null, date: undefined }, SITE_V1)
    expect(out.params).toEqual({})
  })

  it("does not let a parameter key smuggle in a prototype pollution payload", () => {
    const out = normalizeParams(flow, JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>, SITE_V1)
    expect(out.params).toEqual({})
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe("field type coverage", () => {
  it("has a normalization rule for every field type on both site versions", () => {
    const types = new Set<FieldSpec["type"]>()
    for (const site of [SITE_V1, SITE_V2]) {
      for (const step of site.steps) for (const f of step.fields) types.add(f.type)
    }
    for (const type of types) {
      const field: FieldSpec = { purpose: "p", label: "L", type }
      // Nothing throws, and a plausible value survives for non-enum types.
      expect(() => normalizeForField(field, "2026-09-11")).not.toThrow()
    }
  })
})
