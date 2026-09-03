import { beforeEach, describe, expect, it } from "vitest"
import { detectDrift, fingerprintSteps, healFlow } from "../drift"
import { clearAll, saveFlows } from "../store"
import { flowsForOrigin, recallForPage } from "../recall"
import { SITE_V1, SITE_V2, setSiteVersion, TaughtFlow } from "../types"

/**
 * The cache contract:
 *   miss  = nothing known for this origin
 *   hit   = known, and the page still fingerprints the same
 *   stale = known, but the page fingerprints differently
 */

function learnedOn(site: typeof SITE_V1, overrides: Partial<TaughtFlow> = {}): TaughtFlow {
  const fields = site.steps.flatMap((s) => s.fields.map((f) => ({ step: s.intent, f })))
  return {
    id: "flow_auto",
    name: "clinic_booking",
    intent: "Clinic booking",
    learnedBy: "autonomous",
    taughtAt: new Date().toISOString(),
    siteVersionAtTeach: site.version,
    origin: location.origin,
    structureFingerprint: fingerprintSteps(site.steps),
    params: fields.map(({ step, f }) => ({
      key: f.purpose.replace(/ (.)/g, (_m, c: string) => c.toUpperCase()),
      label: f.label,
      type: "string" as const,
      sourceField: { stepIntent: step, fieldPurpose: f.purpose },
    })),
    steps: site.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) })),
    fieldValues: {},
    status: "never_run",
    runCount: 0,
    lastRunAt: null,
    lastHealedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  clearAll()
  setSiteVersion("1.0")
})

describe("fingerprintSteps", () => {
  it("is stable across calls and across structurally identical copies", () => {
    const copy = SITE_V1.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) }))
    expect(fingerprintSteps(SITE_V1.steps)).toBe(fingerprintSteps(SITE_V1.steps))
    expect(fingerprintSteps(copy)).toBe(fingerprintSteps(SITE_V1.steps))
  })

  it("differs between the two site versions", () => {
    expect(fingerprintSteps(SITE_V1.steps)).not.toBe(fingerprintSteps(SITE_V2.steps))
  })

  it("ignores a pure label rename, because that is drift the engine heals from the page", () => {
    const renamed = SITE_V1.steps.map((s) => ({
      ...s,
      fields: s.fields.map((f) => ({ ...f, label: f.label + " (updated)" })),
    }))
    expect(fingerprintSteps(renamed)).toBe(fingerprintSteps(SITE_V1.steps))
  })

  it("changes when a field is added, made required, reordered, or its options change", () => {
    const base = fingerprintSteps(SITE_V1.steps)

    const added = SITE_V1.steps.map((s) =>
      s.intent === "enter patient details"
        ? { ...s, fields: [...s.fields, { purpose: "insurance id", label: "Insurance ID", type: "text" as const }] }
        : s
    )
    expect(fingerprintSteps(added)).not.toBe(base)

    const required = SITE_V1.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, required: false })) }))
    expect(fingerprintSteps(required)).not.toBe(base)

    const reordered = [SITE_V1.steps[1], SITE_V1.steps[0], ...SITE_V1.steps.slice(2)].map((s, i) => ({
      ...s,
      order: i + 1,
    }))
    expect(fingerprintSteps(reordered)).not.toBe(base)

    const options = SITE_V1.steps.map((s) => ({
      ...s,
      fields: s.fields.map((f) => (f.options ? { ...f, options: [...f.options, "mri"] } : f)),
    }))
    expect(fingerprintSteps(options)).not.toBe(base)

    const relabelledButton = SITE_V1.steps.map((s) => ({ ...s, submitLabel: s.submitLabel + "!" }))
    expect(fingerprintSteps(relabelledButton)).not.toBe(base)
  })
})

describe("recallForPage", () => {
  it("misses when nothing is stored", () => {
    const r = recallForPage()
    expect(r.state).toBe("miss")
    expect(r.flows).toHaveLength(0)
    expect(r.nextStep).toMatch(/learn_site/)
  })

  it("hits when the page still fingerprints the same as what was stored", () => {
    saveFlows([learnedOn(SITE_V1)])
    const r = recallForPage()
    expect(r.state).toBe("hit")
    expect(r.flows[0].state).toBe("fresh")
    expect(r.fingerprint).toBe(fingerprintSteps(SITE_V1.steps))
    expect(r.nextStep).toMatch(/nothing needs an answer/i)
  })

  it("goes stale when the page is redesigned under it", () => {
    saveFlows([learnedOn(SITE_V1)])
    setSiteVersion("2.0")
    const r = recallForPage()
    expect(r.state).toBe("stale")
    expect(r.flows[0].state).toBe("stale")
    expect(r.flows[0].changes).toHaveLength(4)
    expect(r.flows[0].questions?.map((q) => q.purpose)).toEqual(["insurance id"])
  })

  it("returns to a hit once healed, because healing refreshes the fingerprint", () => {
    saveFlows([learnedOn(SITE_V1)])
    setSiteVersion("2.0")
    expect(recallForPage().state).toBe("stale")

    const flow = flowsForOrigin()[0]
    const q = detectDrift(flow, SITE_V2).questions[0]
    const { flow: healed } = healFlow(flow, SITE_V2, { [q.id]: "INS-1" })
    saveFlows([healed])

    const r = recallForPage()
    expect(r.state).toBe("hit")
    expect(healed.structureFingerprint).toBe(fingerprintSteps(SITE_V2.steps))
  })

  it("hits without a stored fingerprint when a full diff finds nothing, so legacy flows still work", () => {
    saveFlows([learnedOn(SITE_V1, { structureFingerprint: undefined })])
    expect(recallForPage().state).toBe("hit")
  })

  it("ignores flows learned on another origin", () => {
    saveFlows([learnedOn(SITE_V1, { origin: "https://somewhere-else.example" })])
    expect(recallForPage().state).toBe("miss")
    expect(flowsForOrigin()).toHaveLength(0)
  })

  it("counts a flow with no origin as belonging here, so nothing stored before origins is orphaned", () => {
    saveFlows([learnedOn(SITE_V1, { origin: undefined })])
    expect(flowsForOrigin()).toHaveLength(1)
    expect(recallForPage().state).toBe("hit")
  })

  it("is stale if any known flow is stale, even when others are fresh", () => {
    saveFlows([
      learnedOn(SITE_V1, { id: "a", name: "fresh_one", structureFingerprint: fingerprintSteps(SITE_V2.steps), steps: SITE_V2.steps }),
      learnedOn(SITE_V1, { id: "b", name: "stale_one" }),
    ])
    setSiteVersion("2.0")
    const r = recallForPage()
    expect(r.state).toBe("stale")
    expect(r.flows.find((f) => f.name === "fresh_one")!.state).toBe("fresh")
    expect(r.flows.find((f) => f.name === "stale_one")!.state).toBe("stale")
  })
})
