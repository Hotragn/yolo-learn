import { beforeEach, describe, expect, it } from "vitest"
import {
  ActiveRun,
  clearRun,
  finishRun,
  loadRun,
  planFor,
  resumableRun,
  saveRun,
  sideEffectOf,
} from "../runner"
import { clearAll, loadFlows, saveFlows } from "../store"
import { classifySideEffect, SITE_V1, SITE_V2, TaughtFlow } from "../types"

function taughtOnV1(overrides: Partial<TaughtFlow> = {}): TaughtFlow {
  return {
    id: "flow_1",
    name: "book_appointment",
    intent: "Book an appointment",
    taughtAt: new Date().toISOString(),
    siteVersionAtTeach: "1.0",
    params: [
      {
        key: "patientName",
        label: "Your name",
        type: "string",
        sourceField: { stepIntent: "enter patient details", fieldPurpose: "patient name" },
      },
    ],
    steps: SITE_V1.steps,
    fieldValues: {
      "service type": "checkup",
      date: "2026-09-11",
      time: "10:00 AM",
      "patient name": "Jane Doe",
      phone: "555-0142",
    },
    status: "healthy",
    runCount: 1,
    lastRunAt: null,
    lastHealedAt: null,
    ...overrides,
  }
}

function runAt(stepIndex: number, overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    runId: "run_x",
    flowId: "flow_1",
    toolName: "book_appointment",
    params: {},
    stepIndex,
    filled: {},
    status: "running",
    message: "at step " + (stepIndex + 1),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resumeCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  clearAll()
})

describe("side effect classification", () => {
  it("treats clear navigation wording as harmless", () => {
    for (const label of ["Next", "Continue", "Proceed to review", "Back", "Previous"]) {
      expect(classifySideEffect(label)).toBe("none")
    }
  })

  it("treats anything that commits as irreversible", () => {
    for (const label of ["Book appointment", "Confirm booking", "Pay now", "Place order", "Submit", "Delete"]) {
      expect(classifySideEffect(label)).toBe("irreversible")
    }
  })

  it("handles plural navigation wording", () => {
    expect(classifySideEffect("Onwards")).toBe("none")
    expect(classifySideEffect("Forwards")).toBe("none")
  })

  it("is conservative about wording it does not recognise", () => {
    // Being wrong in this direction only costs an extra confirmation, so
    // anything unrecognised is gated rather than waved through.
    expect(classifySideEffect("Make it so")).toBe("irreversible")
    expect(classifySideEffect("Allons-y")).toBe("irreversible")
    expect(classifySideEffect("")).toBe("irreversible")
  })

  it("defaults a step with no classification to irreversible", () => {
    expect(sideEffectOf({ order: 1, intent: "x", fields: [], submitLabel: "Whatever" })).toBe("irreversible")
    expect(sideEffectOf({ order: 1, intent: "x", fields: [], submitLabel: "Next", sideEffect: "none" })).toBe("none")
  })

  it("puts exactly one gate in the demo flow, on the last step, on both versions", () => {
    for (const site of [SITE_V1, SITE_V2]) {
      const gated = site.steps.filter((s) => sideEffectOf(s) === "irreversible")
      expect(gated).toHaveLength(1)
      expect(gated[0].intent).toBe("confirm booking")
    }
  })
})

describe("planFor", () => {
  it("resolves every field before anything is typed", () => {
    const { items, blocked } = planFor(taughtOnV1(), {}, SITE_V1)
    expect(blocked).toBeUndefined()
    expect(items.map((i) => i.value)).toEqual(["checkup", "2026-09-11", "10:00 AM", "Jane Doe", "555-0142"])
  })

  it("names the parameter to pass when a required field is a parameter with no fallback", () => {
    const flow = taughtOnV1({ fieldValues: { "service type": "checkup", date: "2026-09-11", time: "10:00 AM", phone: "555-0142" } })
    const { blocked } = planFor(flow, {}, SITE_V1)
    expect(blocked).toEqual({ label: "Your name", paramKey: "patientName" })
  })

  it("reports no parameter when the missing field is not one, so the caller is told to heal instead", () => {
    const flow = taughtOnV1({ fieldValues: { "service type": "checkup", date: "2026-09-11", time: "10:00 AM", "patient name": "Jane Doe" } })
    const { blocked } = planFor(flow, {}, SITE_V1)
    expect(blocked?.label).toBe("Phone number")
    expect(blocked?.paramKey).toBeUndefined()
  })

  it("plans against the site in front of it, including a field that only exists in v2", () => {
    const flow = taughtOnV1({ fieldAnswers: { "insurance id": "INS-1" } })
    const { items, blocked } = planFor(flow, {}, SITE_V2)
    expect(blocked).toBeUndefined()
    expect(items.some((i) => i.purpose === "insurance id")).toBe(true)
    // v2 order: date and time first.
    expect(items[0].purpose).toBe("date")
  })
})

describe("persisted run state", () => {
  it("round-trips through sessionStorage", () => {
    saveRun(runAt(2))
    const loaded = loadRun()
    expect(loaded?.stepIndex).toBe(2)
    expect(loaded?.toolName).toBe("book_appointment")
    expect(loaded?.updatedAt).toBeTruthy()
  })

  it("lives in sessionStorage, not localStorage, so it cannot outlive the tab", () => {
    saveRun(runAt(1))
    expect(sessionStorage.getItem("run.v1")).toBeTruthy()
    expect(localStorage.getItem("run.v1")).toBeNull()
  })

  it("survives a simulated document teardown", () => {
    saveRun(runAt(2, { filled: { "service type": "checkup" } }))
    // A reload destroys every module-level variable but not sessionStorage.
    const afterTeardown = resumableRun()
    expect(afterTeardown?.stepIndex).toBe(2)
    expect(afterTeardown?.filled).toEqual({ "service type": "checkup" })
  })

  it("is resumable while running or awaiting approval, and not once settled", () => {
    saveRun(runAt(1, { status: "running" }))
    expect(resumableRun()).not.toBeNull()
    saveRun(runAt(1, { status: "awaiting_approval" }))
    expect(resumableRun()).not.toBeNull()
    for (const status of ["done", "denied", "failed"] as const) {
      saveRun(runAt(1, { status }))
      expect(resumableRun()).toBeNull()
    }
  })

  it("ignores corrupt or half-written run state instead of crashing", () => {
    sessionStorage.setItem("run.v1", "{not json")
    expect(loadRun()).toBeNull()
    sessionStorage.setItem("run.v1", JSON.stringify({ runId: "x" }))
    expect(loadRun()).toBeNull()
    sessionStorage.setItem("run.v1", JSON.stringify({ runId: "x", flowId: "y" }))
    expect(loadRun()).toBeNull()
  })

  it("clears", () => {
    saveRun(runAt(0))
    clearRun()
    expect(loadRun()).toBeNull()
  })
})

describe("finishRun", () => {
  it("writes the outcome to the flow's history, which is where a lost promise is recovered from", () => {
    saveFlows([taughtOnV1()])
    const run = runAt(3)
    finishRun(run, {
      ok: true,
      confirmedByHuman: true,
      stepsExecuted: 4,
      message: "Booking confirmed, reference NSC-1",
      reference: "NSC-1",
    })

    const flow = loadFlows()[0]
    expect(flow.runCount).toBe(2)
    expect(flow.runs?.[0].message).toContain("NSC-1")
    expect(flow.status).toBe("healthy")
    // The settled run stays queryable so get_run_status can still answer.
    expect(loadRun()?.status).toBe("done")
    expect(resumableRun()).toBeNull()
  })

  it("does not increment the run count for a denial, and keeps the flow's status", () => {
    saveFlows([taughtOnV1({ status: "drifted" })])
    finishRun(runAt(3), {
      ok: false,
      confirmedByHuman: false,
      stepsExecuted: 4,
      message: "The user denied the submit. Nothing was submitted.",
    })
    const flow = loadFlows()[0]
    expect(flow.runCount).toBe(1)
    expect(flow.status).toBe("drifted")
    expect(loadRun()?.status).toBe("denied")
  })

  it("records a needs-healing outcome as failed rather than denied", () => {
    saveFlows([taughtOnV1()])
    finishRun(runAt(0), {
      ok: false,
      confirmedByHuman: false,
      stepsExecuted: 0,
      needsHealing: true,
      message: "heal first",
    })
    expect(loadRun()?.status).toBe("failed")
  })

  it("survives the flow being deleted mid-run", () => {
    const result = finishRun(runAt(2), {
      ok: true,
      confirmedByHuman: true,
      stepsExecuted: 4,
      message: "done",
    })
    expect(result.ok).toBe(true)
    expect(loadFlows()).toHaveLength(0)
  })

  it("reports how many teardowns the run survived", () => {
    saveFlows([taughtOnV1()])
    const result = finishRun(runAt(3, { resumeCount: 2 }), {
      ok: true,
      confirmedByHuman: true,
      stepsExecuted: 4,
      message: "done",
    })
    expect(result.resumeCount).toBe(2)
    expect(result.runId).toBe("run_x")
  })
})
