import { describe, expect, it } from "vitest"
import { CHANGES, healsFromPage, taxonomy } from "../drift-taxonomy"
import { detectDrift, rejectedChoice } from "../drift"
import { ChangeType, SITE_V1, SITE_V2, SiteModel, StepSpec, TaughtFlow } from "../types"

function flowOn(steps: StepSpec[], values: Record<string, string>, params: string[] = []): TaughtFlow {
  return {
    id: "f", name: "book", intent: "book", taughtAt: new Date().toISOString(),
    siteVersionAtTeach: "1.0",
    params: params.map((p) => ({
      key: p, label: p, type: "string" as const,
      sourceField: { stepIntent: "choose service", fieldPurpose: p },
    })),
    steps, fieldValues: values, status: "healthy", runCount: 1, lastRunAt: null, lastHealedAt: null,
  }
}
const site = (steps: StepSpec[]): SiteModel => ({ version: "9", changelog: [], steps })
const V1 = SITE_V1.steps
const taught = () =>
  flowOn(V1, { "service type": "checkup", date: "2026-09-11", time: "10:00 AM", "patient name": "Jane", phone: "555" })

describe("the taxonomy is a real registry, not eight loose strings", () => {
  it("describes every change type the detector can emit", () => {
    const emitted = new Set<ChangeType>([
      "RENAMED", "NEW_FIELD", "REMOVED_FIELD", "REORDERED", "WORDING",
      "REMOVED_STEP", "NEW_STEP", "ROUTE_CHANGED",
      "TYPE_CHANGED", "OPTIONS_CHANGED", "REQUIRED_ADDED", "REQUIRED_RELAXED",
    ])
    for (const t of emitted) expect(CHANGES[t]).toBeDefined()
    expect(taxonomy()).toHaveLength(emitted.size)
  })

  it("gives every entry a reason, not just a boolean", () => {
    for (const k of taxonomy()) {
      expect(k.why.length).toBeGreaterThan(20)
      expect(k.meaning.length).toBeGreaterThan(20)
      expect(["page", "human"]).toContain(k.healedBy)
    }
  })

  it("encodes the governing rule: only an unsupplied value needs a human", () => {
    // Everything readable off the page heals from the page.
    for (const t of ["RENAMED", "REORDERED", "WORDING", "REMOVED_FIELD", "REMOVED_STEP", "ROUTE_CHANGED"] as const) {
      expect(healsFromPage(t)).toBe(true)
    }
    // The two that can require a value nobody has ever given.
    expect(healsFromPage("NEW_FIELD")).toBe(false)
    expect(healsFromPage("REQUIRED_ADDED")).toBe(false)
  })
})

describe("the demo contract survives the new change types", () => {
  it("v1 to v2 is still exactly 4 changes and 1 question", () => {
    const r = detectDrift(taught(), SITE_V2)
    expect(r.changes).toHaveLength(4)
    expect(r.questions).toHaveLength(1)
  })
})

describe("a choice the page withdrew", () => {
  const dropped = V1.map((s) =>
    s.intent === "choose service"
      ? { ...s, fields: [{ ...s.fields[0], options: ["physical exam", "flu jab"] }] }
      : s
  )

  it("is detected rather than submitted blank", () => {
    const f = taught()
    expect(rejectedChoice(f, dropped[0].fields[0])).toBe("checkup")
  })

  it("reports the change and says which value is gone", () => {
    const r = detectDrift(taught(), site(dropped))
    const c = r.changes.find((x) => x.type === "OPTIONS_CHANGED")!
    expect(c).toBeDefined()
    expect(c.description).toContain("dropped checkup")
    expect(c.description).toContain('used "checkup"')
    expect(c.autoHealable).toBe(false)
  })

  it("asks a question that names the withdrawn value and the alternatives", () => {
    const r = detectDrift(taught(), site(dropped))
    expect(r.questions).toHaveLength(1)
    expect(r.questions[0].question).toContain('no longer offers "checkup"')
    expect(r.questions[0].question).toContain("physical exam")
  })

  it("does not ask when the list merely grew", () => {
    const grew = V1.map((s) =>
      s.intent === "choose service"
        ? { ...s, fields: [{ ...s.fields[0], options: [...(s.fields[0].options ?? []), "flu jab"] }] }
        : s
    )
    const r = detectDrift(taught(), site(grew))
    expect(r.changes.map((c) => c.type)).toEqual(["OPTIONS_CHANGED"])
    expect(r.changes[0].autoHealable).toBe(true)
    expect(r.questions).toHaveLength(0)
  })

  it("stays silent when the caller supplies that field as a parameter", () => {
    // The agent passes it at call time and the tool boundary validates it, so
    // asking the human would be asking the wrong party.
    // Every other required field must have a value, or those legitimately
    // generate their own questions and the assertion tests nothing.
    const f = flowOn(
      V1,
      { "service type": "checkup", date: "2026-09-11", time: "10:00 AM", "patient name": "Jane", phone: "555" },
      ["service type"]
    )
    expect(detectDrift(f, site(dropped)).questions).toHaveLength(0)
  })
})

describe("required-ness and type moves", () => {
  it("flags a field that became required, and asks when nothing is stored", () => {
    const base = V1.map((s) =>
      s.intent === "enter patient details"
        ? { ...s, fields: [...s.fields, { purpose: "notes", label: "Notes", type: "text" as const }] }
        : s
    )
    const f = flowOn(base, { "service type": "checkup", date: "d", time: "10:00 AM", "patient name": "J", phone: "5" })
    const now = base.map((s) =>
      s.intent === "enter patient details"
        ? { ...s, fields: s.fields.map((x) => (x.purpose === "notes" ? { ...x, required: true } : x)) }
        : s
    )
    const r = detectDrift(f, site(now))
    const c = r.changes.find((x) => x.type === "REQUIRED_ADDED")!
    expect(c.autoHealable).toBe(false)
    expect(r.questions.map((q) => q.purpose)).toContain("notes")
  })

  it("treats a relaxed requirement as nothing to do", () => {
    const now = V1.map((s) =>
      s.intent === "enter patient details"
        ? { ...s, fields: s.fields.map((x) => (x.purpose === "phone" ? { ...x, required: false } : x)) }
        : s
    )
    const r = detectDrift(taught(), site(now))
    expect(r.changes.map((c) => c.type)).toEqual(["REQUIRED_RELAXED"])
    expect(r.changes[0].autoHealable).toBe(true)
    expect(r.questions).toHaveLength(0)
  })

  it("flags a text box tightened into a dropdown", () => {
    const now = V1.map((s) =>
      s.intent === "enter patient details"
        ? { ...s, fields: s.fields.map((x) => (x.purpose === "phone" ? { ...x, type: "select" as const, options: ["555"] } : x)) }
        : s
    )
    const types = detectDrift(taught(), site(now)).changes.map((c) => c.type).sort()
    expect(types).toContain("TYPE_CHANGED")
  })

  it("reports a rename AND a choice change on the same field, not just the first", () => {
    const now = V1.map((s) =>
      s.intent === "choose service"
        ? { ...s, fields: [{ ...s.fields[0], label: "Appointment type", options: ["checkup", "flu jab"] }] }
        : s
    )
    const types = detectDrift(taught(), site(now)).changes.map((c) => c.type).sort()
    expect(types).toEqual(["OPTIONS_CHANGED", "RENAMED"])
  })
})
