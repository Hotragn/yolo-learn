import { beforeEach, describe, expect, it } from "vitest"
import { bugLens, contextFor, crossVerify, runLenses, workflowLens } from "../audit/lenses"

function docOf(html: string): Document {
  document.body.innerHTML = html
  return document
}
const ids = (r: { findings: { rule: { id: string } }[] }) => r.findings.map((f) => f.rule.id)

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("bug lens: every finding cites a rule", () => {
  it("flags a control with no accessible name as high severity", () => {
    const r = bugLens(contextFor(docOf(`<input type="text">`)))
    expect(ids(r)).toContain("wcag-4.1.2")
    expect(r.findings[0].severity).toBe("high")
    expect(r.findings[0].rule.source).toBe("WCAG 2.2")
    expect(r.findings[0].rule.url).toContain("w3.org/TR/WCAG22")
  })

  it("does not flag a control that has a real label", () => {
    const r = bugLens(contextFor(docOf(`<label for="a">Phone</label><input id="a">`)))
    expect(ids(r)).not.toContain("wcag-4.1.2")
  })

  it("flags placeholder-only naming separately, because it vanishes on typing", () => {
    const r = bugLens(contextFor(docOf(`<input placeholder="Search">`)))
    expect(ids(r)).toContain("wcag-3.3.2")
    expect(r.findings[0].detail).toMatch(/disappears/)
  })

  it("flags a missing alt but not a deliberate empty one", () => {
    const bad = bugLens(contextFor(docOf(`<img src="x">`)))
    expect(ids(bad)).toContain("wcag-1.1.1")
    const ok = bugLens(contextFor(docOf(`<img src="x" alt="">`)))
    expect(ids(ok)).not.toContain("wcag-1.1.1")
  })

  it("flags duplicate ids and says how many", () => {
    const r = bugLens(contextFor(docOf(`<i id="d"></i><i id="d"></i><i id="d"></i>`)))
    const f = r.findings.find((x) => x.rule.id === "html-id-unique")!
    expect(f.measured).toBe("3 occurrences")
    expect(f.rule.source).toBe("HTML Living Standard")
  })

  it("flags a control with no form owner", () => {
    const r = bugLens(contextFor(docOf(`<input aria-label="Loose">`)))
    expect(ids(r)).toContain("html-form-owner")
  })

  it("does not flag a control associated by the form attribute", () => {
    const r = bugLens(contextFor(docOf(`<form id="f"></form><input aria-label="ok" form="f">`)))
    expect(ids(r)).not.toContain("html-form-owner")
  })

  it("flags a skipped heading level and names the jump", () => {
    const r = bugLens(contextFor(docOf(`<h1>a</h1><h4>b</h4>`)))
    const f = r.findings.find((x) => x.rule.id === "wcag-1.3.1")!
    expect(f.measured).toBe("h1 then h4")
  })

  it("does not flag a well-formed outline", () => {
    const r = bugLens(contextFor(docOf(`<h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2>`)))
    expect(ids(r)).not.toContain("wcag-1.3.1")
  })

  it("ignores hidden and aria-hidden elements", () => {
    const r = bugLens(contextFor(docOf(`<input style="display:none"><input aria-hidden="true"><input type="hidden">`)))
    expect(r.findings).toHaveLength(0)
  })
})

describe("workflow lens", () => {
  it("flags a form with fields and no way to submit", () => {
    const r = workflowLens(contextFor(docOf(`<form><label>A <input name="a"></label></form>`)))
    expect(ids(r)).toContain("yolo-dead-end")
    expect(r.findings[0].severity).toBe("high")
  })

  it("flags a required field that is impossible to satisfy", () => {
    const r = workflowLens(contextFor(docOf(`<form><input name="a" required disabled><button>Go</button></form>`)))
    const f = r.findings.find((x) => x.rule.id === "yolo-unreachable-required")!
    expect(f.detail).toMatch(/disabled/)
    expect(f.severity).toBe("high")
  })

  it("flags a committing button with nothing explaining what happens", () => {
    const r = workflowLens(contextFor(docOf(`<form><input name="a"><button>Pay now</button></form>`)))
    expect(ids(r)).toContain("yolo-ungated-submit")
  })

  it("does not flag a plain navigation button", () => {
    const r = workflowLens(contextFor(docOf(`<form><input name="a"><button>Next</button></form>`)))
    expect(ids(r)).not.toContain("yolo-ungated-submit")
  })

  it("labels its own opinions as house rules, not standards", () => {
    const r = workflowLens(contextFor(docOf(`<form><input name="a"><button>Pay now</button></form>`)))
    const f = r.findings.find((x) => x.rule.id === "yolo-ungated-submit")!
    expect(f.rule.source).toBe("house rule")
    expect(f.detail).toMatch(/house rule and not a standard/)
  })

  it("says so when there is no workflow to check", () => {
    const r = workflowLens(contextFor(docOf(`<p>nothing</p>`)))
    expect(r.findings).toHaveLength(0)
    expect(r.notes[0]).toMatch(/no forms/i)
  })
})

describe("honesty properties that hold across every lens", () => {
  it("never reports an uncomputable value as a pass", () => {
    // jsdom has no layout, so the theme lens must decline rather than invent.
    const reports = runLenses(docOf(`<p style="color:#777">text</p>`))
    const theme = reports.find((r) => r.lens === "theme")!
    expect(theme.findings).toHaveLength(0)
    expect(theme.notes[0]).toMatch(/no layout/i)
  })

  it("marks every house rule as a house rule and every standard with a URL", () => {
    const reports = runLenses(
      docOf(`<form><input required disabled><button>Pay now</button></form><img src="x"><i id="d"></i><i id="d"></i>`)
    )
    for (const r of reports) {
      for (const f of r.findings) {
        if (f.rule.source === "house rule") expect(f.rule.url).toBe("")
        else expect(f.rule.url).toMatch(/^https:\/\//)
      }
    }
  })

  it("corroborates an element that two lenses reach independently", () => {
    const reports = crossVerify([
      { lens: "bugs", checked: 1, unknowns: [], notes: [], findings: [{ lens: "bugs", severity: "high", rule: { id: "a", name: "a", source: "WCAG 2.2", url: "https://x" }, element: "input#same", detail: "", certainty: "exact" }] },
      { lens: "theme", checked: 1, unknowns: [], notes: [], findings: [{ lens: "theme", severity: "low", rule: { id: "b", name: "b", source: "house rule", url: "" }, element: "input#same", detail: "", certainty: "exact" }] },
    ])
    expect(reports[0].findings[0].corroboratedBy).toEqual(["theme"])
    expect(reports[1].findings[0].corroboratedBy).toEqual(["bugs"])
  })

  it("leaves a lone finding uncorroborated rather than inflating it", () => {
    const reports = runLenses(docOf(`<input>`))
    const bugs = reports.find((r) => r.lens === "bugs")!
    expect(bugs.findings.every((f) => !f.corroboratedBy)).toBe(true)
  })
})
