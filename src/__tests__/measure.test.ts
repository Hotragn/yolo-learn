import { describe, expect, it } from "vitest"
import {
  accessibleName,
  composite,
  contrastRatio,
  parseColor,
  relativeLuminance,
  requiredContrast,
  resolveBackground,
} from "../audit/measure"

const rgb = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a })
const BLACK = rgb(0, 0, 0)
const WHITE = rgb(255, 255, 255)

function dom(html: string): Document {
  document.body.innerHTML = html
  return document
}

/**
 * These assert against values published outside this project, which is the
 * whole point: a contrast implementation that only agrees with itself proves
 * nothing.
 */
describe("WCAG contrast, against published reference values", () => {
  it("black on white is exactly 21:1, the defined maximum", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 6)
  })

  it("a colour against itself is exactly 1:1, the defined minimum", () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 10)
    expect(contrastRatio(rgb(27, 107, 69), rgb(27, 107, 69))).toBeCloseTo(1, 10)
  })

  it("is symmetric: order of the two colours cannot matter", () => {
    const a = rgb(27, 107, 69)
    const b = rgb(250, 249, 245)
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12)
  })

  it("reproduces the documented #767676 / #777777 boundary on white", () => {
    // WebAIM and the WCAG understanding docs both use this pair: #767676 is
    // the darkest grey that still clears 4.5:1 on white, and #777777 is the
    // first one that fails. Any implementation with the transfer function or
    // the coefficients wrong lands on the wrong side of this.
    expect(contrastRatio(parseColor("#767676")!, WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parseColor("#777777")!, WHITE)).toBeLessThan(4.5)
    expect(contrastRatio(parseColor("#767676")!, WHITE)).toBeCloseTo(4.54, 2)
    expect(contrastRatio(parseColor("#777777")!, WHITE)).toBeCloseTo(4.48, 2)
  })

  it("reproduces mid-grey on white at 3.95:1", () => {
    expect(contrastRatio(parseColor("#808080")!, WHITE)).toBeCloseTo(3.95, 2)
  })

  it("uses the WCAG 0.03928 threshold, not the sRGB 0.04045 one", () => {
    // A channel at 10/255 = 0.0392 sits between the two thresholds, so which
    // branch is taken is observable. WCAG's number puts it on the linear side.
    const l = relativeLuminance(rgb(10, 10, 10))
    const wcag = 0.0392156862745098 / 12.92
    expect(l).toBeCloseTo(wcag, 9)
  })

  it("grades this project's own accent as usable for text and as a fill", () => {
    // The palette choice was justified with these numbers, so they are asserted
    // rather than asserted-about.
    const accent = parseColor("#1b6b45")!
    const paper = parseColor("#faf9f5")!
    expect(contrastRatio(accent, paper)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(WHITE, accent)).toBeGreaterThanOrEqual(4.5)
  })
})

describe("large-text thresholds, per SC 1.4.3", () => {
  it("relaxes to 3:1 at 24px, and at 18.66px when bold", () => {
    expect(requiredContrast(16, 400)).toEqual({ threshold: 4.5, large: false })
    expect(requiredContrast(23.9, 400)).toEqual({ threshold: 4.5, large: false })
    expect(requiredContrast(24, 400)).toEqual({ threshold: 3, large: true })
    expect(requiredContrast(18.66, 700)).toEqual({ threshold: 3, large: true })
    // Bold but not big enough, and big-enough-if-bold but not bold.
    expect(requiredContrast(18, 700)).toEqual({ threshold: 4.5, large: false })
    expect(requiredContrast(18.66, 400)).toEqual({ threshold: 4.5, large: false })
  })
})

describe("colour parsing", () => {
  it("handles the forms getComputedStyle returns", () => {
    expect(parseColor("rgb(27, 107, 69)")).toEqual(rgb(27, 107, 69))
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual(rgb(0, 0, 0, 0.5))
    expect(parseColor("rgb(0 0 0 / 50%)")).toEqual(rgb(0, 0, 0, 0.5))
    expect(parseColor("transparent")).toEqual(rgb(0, 0, 0, 0))
  })

  it("handles hex from markup, including 3, 4 and 8 digit forms", () => {
    expect(parseColor("#fff")).toEqual(WHITE)
    expect(parseColor("#1b6b45")).toEqual(rgb(27, 107, 69))
    expect(parseColor("#00000080")!.a).toBeCloseTo(0.502, 3)
    expect(parseColor("#f00f")).toEqual(rgb(255, 0, 0, 1))
  })

  it("returns null for colour spaces it cannot resolve, rather than guessing", () => {
    // These must become UNKNOWN findings, never silent passes.
    expect(parseColor("oklch(0.7 0.1 200)")).toBeNull()
    expect(parseColor("color(display-p3 1 0 0)")).toBeNull()
    expect(parseColor("lab(50% 40 59)")).toBeNull()
    expect(parseColor("")).toBeNull()
    expect(parseColor(null)).toBeNull()
  })
})

describe("alpha compositing", () => {
  it("composites source-over, which naive implementations skip entirely", () => {
    expect(composite(rgb(0, 0, 0, 0.5), WHITE)).toEqual(rgb(127.5, 127.5, 127.5, 1))
    expect(composite(rgb(255, 0, 0, 0), WHITE)).toEqual(WHITE)
    expect(composite(BLACK, WHITE)).toEqual(BLACK)
  })

  it("50% black text on white is a genuinely different ratio from black on white", () => {
    const flat = contrastRatio(BLACK, WHITE)
    const composited = contrastRatio(composite(rgb(0, 0, 0, 0.5), WHITE), WHITE)
    expect(flat).toBeCloseTo(21, 4)
    expect(composited).toBeLessThan(6)
  })
})

describe("resolving the background behind an element", () => {
  it("walks up to the nearest opaque ancestor", () => {
    const d = dom(`<div style="background:#ffffff"><p style="background:transparent"><span id="t">x</span></p></div>`)
    const r = resolveBackground(d.getElementById("t")!, window)
    expect(r.certainty).toBe("exact")
    expect(r.color).toEqual(WHITE)
  })

  it("reports UNKNOWN for a gradient instead of passing it", () => {
    const d = dom(`<div style="background-image:linear-gradient(#fff,#000)"><span id="t">x</span></div>`)
    const r = resolveBackground(d.getElementById("t")!, window)
    expect(r.certainty).toBe("unknown")
    expect(r.color).toBeNull()
    expect(r.reason).toMatch(/gradient/)
  })

  it("falls back to the white canvas when no ancestor paints anything", () => {
    const d = dom(`<span id="t">x</span>`)
    const r = resolveBackground(d.getElementById("t")!, window)
    expect(r.certainty).toBe("exact")
    expect(r.color).toEqual(WHITE)
  })
})

describe("accessible name, in the order ARIA defines", () => {
  it("prefers aria-labelledby over everything, including a real label", () => {
    const d = dom(`<span id="lbl">From labelledby</span>
      <label for="i">From label</label>
      <input id="i" aria-labelledby="lbl" aria-label="From aria-label" title="t" placeholder="p">`)
    expect(accessibleName(d.getElementById("i")!)).toEqual({ name: "From labelledby", from: "aria-labelledby" })
  })

  it("prefers aria-label over a label element", () => {
    const d = dom(`<label for="i">From label</label><input id="i" aria-label="From aria-label">`)
    expect(accessibleName(d.getElementById("i")!).from).toBe("aria-label")
  })

  it("uses a label element over title and placeholder", () => {
    const d = dom(`<label for="i">Phone number</label><input id="i" title="t" placeholder="p">`)
    expect(accessibleName(d.getElementById("i")!)).toEqual({ name: "Phone number", from: "label" })
  })

  it("strips the control out of a wrapping label", () => {
    const d = dom(`<label id="l">Year group <select id="i"><option>Year 3</option><option>Year 4</option></select></label>`)
    expect(accessibleName(d.getElementById("i")!).name).toBe("Year group")
  })

  it("treats placeholder as the last resort it is", () => {
    const d = dom(`<input id="i" placeholder="Search">`)
    expect(accessibleName(d.getElementById("i")!)).toEqual({ name: "Search", from: "placeholder" })
  })

  it("finds no name at all when there is none", () => {
    const d = dom(`<input id="i"><button id="b"></button>`)
    expect(accessibleName(d.getElementById("i")!).from).toBe("none")
    expect(accessibleName(d.getElementById("b")!).from).toBe("none")
  })

  it("names a button from its content, and an icon button from its img alt", () => {
    const d = dom(`<button id="b">Book appointment</button>
      <button id="c"><img alt="Close" src="x"></button>`)
    expect(accessibleName(d.getElementById("b")!)).toEqual({ name: "Book appointment", from: "content" })
    expect(accessibleName(d.getElementById("c")!).name).toBe("Close")
  })

  it("distinguishes a deliberately decorative image from a missing alt", () => {
    const d = dom(`<img id="dec" alt="" src="x"><img id="miss" src="x"><img id="ok" alt="A chart" src="x">`)
    // alt="" is a valid claim that the image carries no meaning.
    expect(accessibleName(d.getElementById("dec")!).from).toBe("none")
    expect(d.getElementById("dec")!.getAttribute("alt")).toBe("")
    expect(d.getElementById("miss")!.getAttribute("alt")).toBeNull()
    expect(accessibleName(d.getElementById("ok")!).name).toBe("A chart")
  })

  it("uses the browser's implicit label for a valueless submit input", () => {
    const d = dom(`<input id="s" type="submit"><input id="v" type="submit" value="Send it">`)
    expect(accessibleName(d.getElementById("s")!).name).toBe("Submit")
    expect(accessibleName(d.getElementById("v")!).name).toBe("Send it")
  })
})

describe("this project's own palette, so a regression cannot slip back in", () => {
  // --ink-faint was shipped at #8a8a80 and measured 3.31:1 on the paper
  // background by this project's own theme lens. It carries 11px labels, which
  // is small text, so there is no large-text relaxation to hide behind.
  const PAPER = parseColor("#faf9f5")!
  const DARK_SURFACE = parseColor("#191914")!

  it("light-mode text tokens clear 4.5:1 on the paper background", () => {
    for (const token of ["#1a1a17", "#5c5c54", "#6f6f66"]) {
      expect(contrastRatio(parseColor(token)!, PAPER)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("rejects the value that actually shipped broken", () => {
    expect(contrastRatio(parseColor("#8a8a80")!, PAPER)).toBeLessThan(4.5)
    expect(contrastRatio(parseColor("#8a8a80")!, PAPER)).toBeCloseTo(3.31, 2)
  })

  it("dark-mode text tokens clear 4.5:1 on the dark surface", () => {
    for (const token of ["#f7f8f8", "#9b9fa4", "#8e9289"]) {
      expect(contrastRatio(parseColor(token)!, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("rejects the dark value that also shipped broken", () => {
    expect(contrastRatio(parseColor("#74787d")!, DARK_SURFACE)).toBeLessThan(4.5)
  })
})
