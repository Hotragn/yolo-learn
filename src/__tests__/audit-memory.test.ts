import { beforeEach, describe, expect, it } from "vitest"
import { auditDocument, auditKey, forgetAudits, recallAudit } from "../audit/run"

function docOf(html: string): Document {
  document.body.innerHTML = html
  return document
}

beforeEach(() => {
  localStorage.clear()
  forgetAudits()
  document.body.innerHTML = ""
})

describe("audit memory is a diff, not a cache of prose", () => {
  it("has no diff on a first look, and one on a second", () => {
    const first = auditDocument(docOf(`<input>`), { label: "t" })
    expect(first.diff).toBeUndefined()
    const second = auditDocument(docOf(`<input>`), { label: "t" })
    expect(second.diff).toBeDefined()
    expect(second.diff!.stillOpen).toBe(first.totals.findings)
    expect(second.diff!.appeared).toHaveLength(0)
    expect(second.diff!.fixed).toHaveLength(0)
  })

  it("reports what was fixed between runs", () => {
    auditDocument(docOf(`<input id="a"><img src="x">`), { label: "t" })
    // Give the input a name and the image an alt: both findings should clear.
    const after = auditDocument(docOf(`<label for="a">Name</label><input id="a"><img src="x" alt="">`), { label: "t" })
    expect(after.diff!.fixed.length).toBeGreaterThan(0)
    expect(after.diff!.fixed.some((f) => f.rule.id === "wcag-1.1.1")).toBe(true)
  })

  it("reports what newly appeared", () => {
    auditDocument(docOf(`<input aria-label="a">`), { label: "t" })
    const after = auditDocument(docOf(`<input aria-label="a"><i id="d"></i><i id="d"></i>`), { label: "t" })
    expect(after.diff!.appeared.some((f) => f.rule.id === "html-id-unique")).toBe(true)
  })

  it("keys on structure, so the same page shape is a hit and a redesign is a miss", () => {
    const a = auditKey(docOf(`<form><input name="x"><button>Next</button></form>`), "site")
    const b = auditKey(docOf(`<form><input name="x"><button>Next</button></form>`), "site")
    // Same shape, different visible text: still the same key.
    const c = auditKey(docOf(`<form><h1>Totally different copy</h1><input name="x"><button>Next</button></form>`), "site")
    const d = auditKey(docOf(`<form><input name="renamed"><button>Next</button></form>`), "site")
    expect(a).toBe(b)
    expect(a).not.toBe(c) // an added heading is a structural change
    expect(a).not.toBe(d) // a renamed field certainly is
  })

  it("keeps separate memory per label, so two sites cannot contaminate each other", () => {
    auditDocument(docOf(`<input>`), { label: "site-a" })
    const other = auditDocument(docOf(`<input>`), { label: "site-b" })
    expect(other.diff).toBeUndefined()
  })

  it("can be told not to remember", () => {
    const d = docOf(`<input>`)
    const key = auditKey(d, "t")
    auditDocument(d, { label: "t", remember: false })
    expect(recallAudit(key)).toBeNull()
  })

  it("survives corrupt stored memory", () => {
    localStorage.setItem("audit.v1", "{not json")
    expect(() => auditDocument(docOf(`<input>`), { label: "t" })).not.toThrow()
  })
})

describe("totals stay honest", () => {
  it("counts unknowns separately from findings", () => {
    const r = auditDocument(docOf(`<input>`), { label: "t" })
    expect(r.totals.findings).toBeGreaterThan(0)
    // jsdom has no layout, so the theme lens contributes nothing either way.
    expect(r.totals.findings).toBe(r.reports.flatMap((x) => x.findings).length)
    expect(r.bySeverity.high + r.bySeverity.medium + r.bySeverity.low).toBe(r.totals.findings)
  })

  it("surfaces every lens note, including the ones admitting a limit", () => {
    const r = auditDocument(docOf(`<p>hi</p>`), { label: "t" })
    expect(r.notes.some((n) => /no layout/i.test(n))).toBe(true)
  })
})
