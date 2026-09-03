import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearAll,
  deleteFlow,
  getAudit,
  getFlow,
  loadFlows,
  logEvent,
  patchFlow,
  restoreFlow,
  saveFlows,
  subscribe,
  updateFlows,
  upsertFlow,
} from "../store"
import { SITE_V1, TaughtFlow, uniqueName } from "../types"

function flow(id: string, name: string): TaughtFlow {
  return {
    id,
    name,
    intent: "Book appointment",
    taughtAt: new Date().toISOString(),
    siteVersionAtTeach: "1.0",
    params: [],
    steps: SITE_V1.steps,
    fieldValues: {},
    status: "never_run",
    runCount: 0,
    lastRunAt: null,
    lastHealedAt: null,
  }
}

beforeEach(() => {
  localStorage.clear()
  clearAll()
})

describe("cold load", () => {
  it("returns an empty library when localStorage is empty", () => {
    localStorage.clear()
    expect(loadFlows()).toEqual([])
    expect(getAudit()).toEqual([])
  })

  it("survives corrupt storage instead of crashing the app", () => {
    localStorage.setItem("flows.v1", "{not json")
    expect(loadFlows()).toEqual([])
    localStorage.setItem("flows.v1", '"a string"')
    expect(loadFlows()).toEqual([])
    localStorage.setItem("audit.v1", "nope")
    expect(getAudit()).toEqual([])
  })

  it("drops entries that are missing the fields the UI reads", () => {
    localStorage.setItem("flows.v1", JSON.stringify([{ id: "x" }, flow("ok", "good_flow")]))
    expect(loadFlows().map((f) => f.id)).toEqual(["ok"])
  })
})

describe("patchFlow", () => {
  it("patches an existing flow", () => {
    upsertFlow(flow("a", "one"))
    expect(patchFlow("a", { runCount: 3 })?.runCount).toBe(3)
    expect(getFlow("a")?.runCount).toBe(3)
  })

  it("returns undefined for a flow deleted mid-run, and does not resurrect it", () => {
    upsertFlow(flow("a", "one"))
    deleteFlow("a")
    expect(patchFlow("a", { runCount: 9 })).toBeUndefined()
    expect(loadFlows()).toHaveLength(0)
  })
})

describe("delete and undo", () => {
  it("restores a deleted flow to its original position", () => {
    saveFlows([flow("a", "one"), flow("b", "two"), flow("c", "three")])
    const deleted = deleteFlow("b")
    expect(deleted?.index).toBe(1)
    expect(loadFlows().map((f) => f.id)).toEqual(["a", "c"])
    restoreFlow(deleted!)
    expect(loadFlows().map((f) => f.id)).toEqual(["a", "b", "c"])
  })

  it("ignores a double undo instead of duplicating the flow", () => {
    saveFlows([flow("a", "one")])
    const deleted = deleteFlow("a")!
    restoreFlow(deleted)
    restoreFlow(deleted)
    expect(loadFlows()).toHaveLength(1)
  })

  it("returns null when deleting something that is already gone", () => {
    expect(deleteFlow("missing")).toBeNull()
  })
})

describe("notifications", () => {
  it("notifies subscribers once per write, and stops after unsubscribe", () => {
    const seen = vi.fn()
    const off = subscribe(seen)
    upsertFlow(flow("a", "one"))
    expect(seen).toHaveBeenCalledTimes(1)
    off()
    upsertFlow(flow("b", "two"))
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it("does not recurse when a listener writes back during a notification", () => {
    saveFlows([flow("a", "one")])
    let calls = 0
    const off = subscribe(() => {
      calls++
      // A status-repairing listener writes while being notified. This must
      // settle, not stack up notifications.
      if (calls < 20) patchFlow("a", { runCount: calls })
    })
    upsertFlow(flow("a", "one"))
    off()
    expect(calls).toBeLessThan(30)
  })

  it("keeps a throwing listener from breaking the others", () => {
    const good = vi.fn()
    const offBad = subscribe(() => {
      throw new Error("boom")
    })
    const offGood = subscribe(good)
    upsertFlow(flow("a", "one"))
    expect(good).toHaveBeenCalled()
    offBad()
    offGood()
  })
})

describe("updateFlows", () => {
  it("rewrites every flow in one pass and only writes when something changed", () => {
    saveFlows([flow("a", "one"), flow("b", "two")])
    const seen = vi.fn()
    const off = subscribe(seen)
    updateFlows((f) => f)
    expect(seen).not.toHaveBeenCalled()
    updateFlows((f) => ({ ...f, status: "drifted" }))
    expect(seen).toHaveBeenCalledTimes(1)
    expect(loadFlows().every((f) => f.status === "drifted")).toBe(true)
    off()
  })
})

describe("audit trail", () => {
  it("keeps newest first and caps the history", () => {
    for (let i = 0; i < 120; i++) logEvent("run", `event ${i}`)
    const events = getAudit()
    expect(events).toHaveLength(100)
    expect(events[0].detail).toBe("event 119")
  })
})

describe("uniqueName", () => {
  it("slugifies and leaves a free name alone", () => {
    expect(uniqueName("Book Appointment", [])).toBe("book_appointment")
  })

  it("suffixes rather than colliding, because registerTool rejects duplicates", () => {
    expect(uniqueName("book_appointment", ["book_appointment"])).toBe("book_appointment_2")
    expect(uniqueName("book_appointment", ["book_appointment", "book_appointment_2"])).toBe("book_appointment_3")
  })

  it("falls back to a usable name for input that slugifies to nothing", () => {
    expect(uniqueName("!!!", [])).toBe("my_flow")
    expect(uniqueName("", ["my_flow"])).toBe("my_flow_2")
  })
})
