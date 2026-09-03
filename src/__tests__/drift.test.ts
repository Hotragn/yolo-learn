import { describe, expect, it } from "vitest"
import { detectDrift, healFlow, storedValue, valueForField } from "../drift"
import { SITE_V1, SITE_V2, SiteModel, TaughtFlow } from "../types"

/** A flow taught by hand on v1, with every required field demonstrated. */
function taughtOnV1(overrides: Partial<TaughtFlow> = {}): TaughtFlow {
  return {
    id: "flow_1",
    name: "book_appointment",
    intent: "Book an appointment at Northside Family Clinic",
    taughtAt: "2026-09-01T10:00:00.000Z",
    siteVersionAtTeach: "1.0",
    params: [
      {
        key: "date",
        label: "Preferred date",
        type: "string",
        sourceField: { stepIntent: "pick date and time", fieldPurpose: "date" },
      },
      {
        key: "patientName",
        label: "Your name",
        type: "string",
        sourceField: { stepIntent: "enter patient details", fieldPurpose: "patient name" },
      },
    ],
    steps: SITE_V1.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) })),
    fieldValues: {
      "service type": "checkup",
      date: "2026-09-11",
      time: "10:00 AM",
      "patient name": "Jane Doe",
      phone: "555-0142",
    },
    status: "never_run",
    runCount: 0,
    lastRunAt: null,
    lastHealedAt: null,
    ...overrides,
  }
}

describe("detectDrift against the same version", () => {
  it("reports healthy with no changes and no questions", () => {
    const report = detectDrift(taughtOnV1(), SITE_V1)
    expect(report.status).toBe("healthy")
    expect(report.changes).toHaveLength(0)
    expect(report.questions).toHaveLength(0)
    expect(report.summary).toMatch(/still matches/i)
  })
})

describe("detectDrift v1 flow against the v2 redesign", () => {
  const report = detectDrift(taughtOnV1(), SITE_V2)

  it("is the demo contract: exactly 4 changes and exactly 1 question", () => {
    expect(report.status).toBe("drifted")
    expect(report.changes).toHaveLength(4)
    expect(report.questions).toHaveLength(1)
  })

  it("names one change per real-world edit, matching the site changelog", () => {
    expect(report.changes.map((c) => c.type).sort()).toEqual([
      "NEW_FIELD",
      "RENAMED",
      "REORDERED",
      "WORDING",
    ])
    expect(SITE_V2.changelog).toHaveLength(report.changes.length)
  })

  it("counts a single swap as one reorder, not one per moved step", () => {
    const reorders = report.changes.filter((c) => c.type === "REORDERED")
    expect(reorders).toHaveLength(1)
    expect(reorders[0].description).toContain("pick date and time")
    expect(reorders[0].description).toContain("choose service")
  })

  it("auto-heals everything except the new required field", () => {
    expect(report.changes.filter((c) => !c.autoHealable).map((c) => c.type)).toEqual(["NEW_FIELD"])
  })

  it("asks only about the insurance ID", () => {
    expect(report.questions[0].purpose).toBe("insurance id")
    expect(report.questions[0].question).toContain("Insurance ID")
  })

  it("does not ask about the renamed field, because the purpose is unchanged", () => {
    expect(report.questions.some((q) => q.purpose === "patient name")).toBe(false)
  })
})

describe("healFlow", () => {
  it("heals to green with an answer, and the flow then matches v2", () => {
    const flow = taughtOnV1()
    const q = detectDrift(flow, SITE_V2).questions[0]
    const { flow: healed, applied, remainingQuestions } = healFlow(flow, SITE_V2, { [q.id]: "INS-99812" })

    expect(applied).toEqual(["Insurance ID"])
    expect(remainingQuestions).toHaveLength(0)
    expect(healed.status).toBe("healthy")
    expect(healed.fieldAnswers?.["insurance id"]).toBe("INS-99812")
    expect(detectDrift(healed, SITE_V2).status).toBe("healthy")
    expect(healed.lastHealedAt).toBeTruthy()
  })

  it("keeps the flow drifted when the answer is empty, and asks again", () => {
    const flow = taughtOnV1()
    const q = detectDrift(flow, SITE_V2).questions[0]
    const { flow: healed, applied, remainingQuestions } = healFlow(flow, SITE_V2, { [q.id]: "   " })

    expect(applied).toEqual([])
    expect(healed.status).toBe("drifted")
    expect(remainingQuestions.map((r) => r.purpose)).toEqual(["insurance id"])
    // The question survives, so the user is never stuck with an unrunnable
    // flow that reports itself healthy.
    expect(detectDrift(healed, SITE_V2).questions).toHaveLength(1)
  })

  it("accepts an answer keyed by purpose as well as by question id", () => {
    const { flow: healed } = healFlow(taughtOnV1(), SITE_V2, { "insurance id": "INS-1" })
    expect(healed.fieldAnswers?.["insurance id"]).toBe("INS-1")
  })

  it("healing v1 to v2 and back leaves nothing to ask on either version", () => {
    const q = detectDrift(taughtOnV1(), SITE_V2).questions[0]
    const { flow: healed } = healFlow(taughtOnV1(), SITE_V2, { [q.id]: "INS-42" })
    expect(detectDrift(healed, SITE_V2).status).toBe("healthy")
    // Going back to v1 is itself drift (the field disappears), but all of it is
    // auto-healable and it asks nothing.
    const back = detectDrift(healed, SITE_V1)
    expect(back.questions).toHaveLength(0)
    expect(back.changes.every((c) => c.autoHealable)).toBe(true)
  })

  it("truncates an oversized answer instead of storing it whole", () => {
    const q = detectDrift(taughtOnV1(), SITE_V2).questions[0]
    const { flow: healed } = healFlow(taughtOnV1(), SITE_V2, { [q.id]: "x".repeat(5000) })
    expect(healed.fieldAnswers!["insurance id"].length).toBe(200)
  })
})

describe("structural edits beyond the scripted redesign", () => {
  const site = (steps: SiteModel["steps"]): SiteModel => ({ version: "3.0", changelog: [], steps })

  it("reports a removed step as auto-healable", () => {
    const model = site(
      SITE_V1.steps.filter((s) => s.intent !== "choose service").map((s, i) => ({ ...s, order: i + 1 }))
    )
    const report = detectDrift(taughtOnV1(), model)
    expect(report.changes.some((c) => c.type === "REMOVED_STEP")).toBe(true)
    expect(report.questions).toHaveLength(0)
  })

  it("reports a brand new step and asks about its required field", () => {
    const model = site([
      ...SITE_V1.steps,
      {
        order: 5,
        intent: "pay deposit",
        fields: [{ purpose: "card last four", label: "Card last 4", type: "text", required: true }],
        submitLabel: "Pay",
      },
    ])
    const report = detectDrift(taughtOnV1(), model)
    const newStep = report.changes.find((c) => c.type === "NEW_STEP")
    expect(newStep).toBeDefined()
    expect(newStep!.autoHealable).toBe(false)
    expect(report.questions.map((q) => q.purpose)).toEqual(["card last four"])
  })

  it("does not ask about a new optional field", () => {
    const steps = SITE_V1.steps.map((s) =>
      s.intent === "enter patient details"
        ? { ...s, fields: [...s.fields, { purpose: "notes", label: "Anything else?", type: "text" as const }] }
        : s
    )
    const report = detectDrift(taughtOnV1(), site(steps))
    expect(report.changes.map((c) => c.type)).toEqual(["NEW_FIELD"])
    expect(report.changes[0].autoHealable).toBe(true)
    expect(report.questions).toHaveLength(0)
  })

  it("asks about a required field the demonstration left blank", () => {
    const flow = taughtOnV1({
      fieldValues: { "service type": "checkup", date: "2026-09-11", time: "10:00 AM", phone: "555-0142" },
    })
    const report = detectDrift(flow, SITE_V1)
    expect(report.changes).toHaveLength(0)
    expect(report.questions.map((q) => q.purpose)).toEqual(["patient name"])
    expect(report.status).toBe("drifted")
  })
})

describe("value resolution", () => {
  it("prefers a run parameter over the demonstrated value", () => {
    const flow = taughtOnV1()
    const field = SITE_V1.steps[2].fields[0]
    expect(valueForField(flow, { patientName: "Sam Rivera" }, field)).toBe("Sam Rivera")
    expect(valueForField(flow, {}, field)).toBe("Jane Doe")
  })

  it("keeps a parameter bound to its purpose after the field is renamed and moved", () => {
    const flow = taughtOnV1()
    const renamed = SITE_V2.steps[2].fields[0]
    expect(renamed.label).toBe("Full name (as on insurance card)")
    expect(valueForField(flow, { patientName: "Sam Rivera" }, renamed)).toBe("Sam Rivera")
  })

  it("ignores an empty parameter and clamps an oversized one", () => {
    const flow = taughtOnV1()
    const field = SITE_V1.steps[2].fields[0]
    expect(valueForField(flow, { patientName: "" }, field)).toBe("Jane Doe")
    expect(valueForField(flow, { patientName: null }, field)).toBe("Jane Doe")
    expect(valueForField(flow, { patientName: "y".repeat(300) }, field)!.length).toBe(200)
  })

  it("falls back to a healed answer when there is no demonstrated value", () => {
    const flow = taughtOnV1({ fieldAnswers: { "insurance id": "INS-7" } })
    expect(storedValue(flow, "insurance id")).toBe("INS-7")
    expect(storedValue(flow, "nothing")).toBeUndefined()
  })
})
