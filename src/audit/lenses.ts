import { classifySideEffect } from "../types"
import {
  accessibleName,
  Certainty,
  contrastRatio,
  describeElement,
  parseColor,
  requiredContrast,
  resolveBackground,
} from "./measure"

/**
 * Three lenses over the same page.
 *
 * Every finding cites the rule that produced it, and the `source` field says
 * plainly whether that rule is a published standard or a preference of ours.
 * That distinction is load-bearing: "SC 1.4.3 says 4.5:1 and this measures
 * 3.1:1" is a fact, whereas "your radii are inconsistent" is an opinion, and
 * presenting the second as the first is the kind of false confidence this
 * project exists to argue against.
 *
 * A check that cannot be computed reports certainty "unknown" and is counted
 * separately. It is never rolled into the pass column.
 */

export type Lens = "bugs" | "workflow" | "theme"

export type RuleSource = "WCAG 2.2" | "HTML Living Standard" | "ARIA 1.2" | "house rule"

export interface Rule {
  id: string
  name: string
  source: RuleSource
  url: string
}

export interface Finding {
  lens: Lens
  severity: "high" | "medium" | "low"
  rule: Rule
  element: string
  detail: string
  measured?: string
  threshold?: string
  certainty: Certainty
  /** Set when another lens independently flagged the same element. */
  corroboratedBy?: Lens[]
}

export interface LensReport {
  lens: Lens
  checked: number
  findings: Finding[]
  /** Checks that could not be computed, kept out of the pass count. */
  unknowns: Finding[]
  notes: string[]
}

/**
 * SC 2.5.8's inline exception, evaluated rather than waved through as a disclaimer.
 *
 * A text link whose height is the surrounding line-height, or that sits in a
 * sentence, is exempt. An 18x18 icon button is not. Width already at or above
 * 24px with a line-height-capped height is a line of text, not a missed tap target.
 */
export function isTargetSizeExempt(args: {
  tagName: string
  display: string
  width: number
  height: number
  fontSize: number
  lineHeight: number
  inSentence: boolean
}): boolean {
  if (Math.min(args.width, args.height) >= 24) return true
  const tag = args.tagName.toUpperCase()
  if (tag !== "A") return false
  if (args.inSentence) return true
  if (args.display === "inline") return true
  const cap = Math.max(args.lineHeight || 0, args.fontSize * 1.5) + 2
  return args.width >= 24 && args.height <= cap
}

/** One row per repeated target-size class, not one row per footer link. */
export function collapseRepeatedFindings(findings: Finding[]): void {
  const others = findings.filter((f) => f.rule.id !== "wcag-2.5.8")
  const targets = findings.filter((f) => f.rule.id === "wcag-2.5.8")
  if (targets.length < 2) return
  const groups = new Map<string, Finding[]>()
  for (const f of targets) {
    const stem = f.element.replace(/#[^\s.[\]]+/g, "").trim() || f.element
    const key = `${f.measured}|${stem}`
    const g = groups.get(key) ?? []
    g.push(f)
    groups.set(key, g)
  }
  const collapsed: Finding[] = []
  for (const group of groups.values()) {
    const first = group[0]
    if (group.length === 1) {
      collapsed.push(first)
      continue
    }
    const stem = first.element.replace(/#[^\s.[\]]+/g, "").trim() || "targets"
    collapsed.push({
      ...first,
      element: `${group.length} similar ${stem}`,
      detail: `${group.length} pointer targets share this size (${first.measured}). Listed once. ${first.detail}`,
    })
  }
  findings.length = 0
  findings.push(...others, ...collapsed)
}

const W = (frag: string) => `https://www.w3.org/TR/WCAG22/#${frag}`

export const RULES: Record<string, Rule> = {
  name: {
    id: "wcag-4.1.2",
    name: "Name, Role, Value",
    source: "WCAG 2.2",
    url: W("name-role-value"),
  },
  alt: {
    id: "wcag-1.1.1",
    name: "Non-text Content",
    source: "WCAG 2.2",
    url: W("non-text-content"),
  },
  labelInstruction: {
    id: "wcag-3.3.2",
    name: "Labels or Instructions",
    source: "WCAG 2.2",
    url: W("labels-or-instructions"),
  },
  info: {
    id: "wcag-1.3.1",
    name: "Info and Relationships",
    source: "WCAG 2.2",
    url: W("info-and-relationships"),
  },
  contrast: {
    id: "wcag-1.4.3",
    name: "Contrast (Minimum)",
    source: "WCAG 2.2",
    url: W("contrast-minimum"),
  },
  nonTextContrast: {
    id: "wcag-1.4.11",
    name: "Non-text Contrast",
    source: "WCAG 2.2",
    url: W("non-text-contrast"),
  },
  target: {
    id: "wcag-2.5.8",
    name: "Target Size (Minimum)",
    source: "WCAG 2.2",
    url: W("target-size-minimum"),
  },
  duplicateId: {
    id: "html-id-unique",
    name: "The id attribute must be unique",
    source: "HTML Living Standard",
    url: "https://html.spec.whatwg.org/multipage/dom.html#the-id-attribute",
  },
  orphanControl: {
    id: "html-form-owner",
    name: "A control with no form owner submits nothing",
    source: "HTML Living Standard",
    url: "https://html.spec.whatwg.org/multipage/forms.html#form-owner",
  },
  ungatedSubmit: {
    id: "yolo-ungated-submit",
    name: "A committing step with no confirmation",
    source: "house rule",
    url: "",
  },
  deadEnd: {
    id: "yolo-dead-end",
    name: "A step that does not advance",
    source: "house rule",
    url: "",
  },
  unreachable: {
    id: "yolo-unreachable-required",
    name: "A required field with no way to fill it",
    source: "house rule",
    url: "",
  },
  scale: {
    id: "yolo-scale-drift",
    name: "Values off the declared scale",
    source: "house rule",
    url: "",
  },
  tinyText: {
    id: "yolo-tiny-text",
    name: "Text smaller than the house minimum",
    source: "house rule",
    url: "",
  },
}

interface Ctx {
  doc: Document
  win: Window
  /** False in a parsed document, where getBoundingClientRect returns zeroes. */
  hasLayout: boolean
}

export function contextFor(doc: Document): Ctx {
  const win = doc.defaultView
  const hasLayout = !!win && doc.body.getBoundingClientRect().height > 0
  return { doc, win: win ?? (globalThis as unknown as Window), hasLayout }
}

const CONTROLS = "input, select, textarea, button, a[href], [role=button], [role=link]"
const isHidden = (el: Element) =>
  (el as HTMLElement).hidden ||
  (el.getAttribute("style") ?? "").replace(/\s/g, "").includes("display:none") ||
  (el as HTMLInputElement).type === "hidden" ||
  el.getAttribute("aria-hidden") === "true"

// --- lens 1: structure and semantics ------------------------------------

export function bugLens(ctx: Ctx): LensReport {
  const findings: Finding[] = []
  const unknowns: Finding[] = []
  const notes: string[] = []
  let checked = 0

  // Controls with no accessible name. This is the single most common blocker
  // for anyone driving a page by voice or screen reader, and for an agent.
  for (const el of ctx.doc.querySelectorAll(CONTROLS)) {
    if (isHidden(el)) continue
    checked++
    const { name, from } = accessibleName(el)
    if (!name) {
      findings.push({
        lens: "bugs",
        severity: "high",
        rule: RULES.name,
        element: describeElement(el),
        detail: `This ${el.tagName.toLowerCase()} has no accessible name from any source, so nothing can refer to it: not a screen reader, not voice control, not an agent.`,
        certainty: "exact",
      })
    } else if (from === "placeholder") {
      findings.push({
        lens: "bugs",
        severity: "medium",
        rule: RULES.labelInstruction,
        element: describeElement(el),
        detail: `Its only name is the placeholder "${name}", which disappears as soon as anyone types. The field becomes unidentifiable exactly when it is being filled.`,
        certainty: "exact",
      })
    } else if (from === "title") {
      findings.push({
        lens: "bugs",
        severity: "low",
        rule: RULES.labelInstruction,
        element: describeElement(el),
        detail: `Named only by its title attribute, which is not shown on touch devices and is unreliable with assistive technology.`,
        certainty: "exact",
      })
    }
  }

  // Images with no alt attribute at all. alt="" is deliberate and correct for
  // decoration, so it is not flagged.
  for (const img of ctx.doc.querySelectorAll("img")) {
    if (isHidden(img)) continue
    checked++
    if (img.getAttribute("alt") === null) {
      findings.push({
        lens: "bugs",
        severity: "medium",
        rule: RULES.alt,
        element: describeElement(img),
        detail: `No alt attribute. If it is decorative, alt="" says so deliberately; a missing attribute leaves assistive technology to read the file name.`,
        certainty: "exact",
      })
    }
  }

  // Duplicate ids. Breaks label association, aria-labelledby and getElementById.
  const seen = new Map<string, number>()
  for (const el of ctx.doc.querySelectorAll("[id]")) {
    const id = el.getAttribute("id")!
    seen.set(id, (seen.get(id) ?? 0) + 1)
  }
  for (const [id, count] of seen) {
    checked++
    if (count > 1) {
      findings.push({
        lens: "bugs",
        severity: "high",
        rule: RULES.duplicateId,
        element: `#${id}`,
        detail: `${count} elements share id "${id}". Label association, aria-labelledby and getElementById all resolve to the first one, so the rest are silently unreachable.`,
        measured: `${count} occurrences`,
        threshold: "1",
        certainty: "exact",
      })
    }
  }

  // Controls with no form owner: pressing enter submits nothing.
  for (const el of ctx.doc.querySelectorAll("input, select, textarea")) {
    if (isHidden(el)) continue
    const owner = (el as HTMLInputElement).form
    if (!owner && !el.closest("form") && !el.getAttribute("form")) {
      checked++
      findings.push({
        lens: "bugs",
        severity: "low",
        rule: RULES.orphanControl,
        element: describeElement(el),
        detail: `Not inside a form and no form attribute, so it has no form owner. Its value is never submitted and Enter does nothing.`,
        certainty: "exact",
      })
    }
  }

  // Heading levels that skip. Structure is how anyone navigating by headings
  // builds a mental model of the page.
  const headings = [...ctx.doc.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => !isHidden(h))
  let previous = 0
  for (const h of headings) {
    const level = +h.tagName[1]
    checked++
    if (previous && level > previous + 1) {
      findings.push({
        lens: "bugs",
        severity: "low",
        rule: RULES.info,
        element: describeElement(h),
        detail: `Jumps from h${previous} to h${level}. A heading outline with a gap in it implies a section that is not there.`,
        measured: `h${previous} then h${level}`,
        certainty: "exact",
      })
    }
    previous = level
  }
  if (!headings.length) notes.push("No headings at all, so heading structure could not be assessed.")

  return { lens: "bugs", checked, findings, unknowns, notes }
}

// --- lens 2: workflows ---------------------------------------------------

export function workflowLens(ctx: Ctx): LensReport {
  const findings: Finding[] = []
  const unknowns: Finding[] = []
  const notes: string[] = []
  let checked = 0

  const forms = [...ctx.doc.querySelectorAll("form")]
  if (!forms.length) {
    notes.push("No forms on this page, so there is no workflow to check.")
    return { lens: "workflow", checked, findings, unknowns, notes }
  }

  for (const form of forms) {
    const buttons = [...form.querySelectorAll<HTMLElement>("button, input[type=submit], input[type=button]")].filter(
      (b) => !isHidden(b)
    )
    const controls = [...form.querySelectorAll<HTMLElement>("input, select, textarea")].filter((c) => !isHidden(c))

    checked++
    if (!buttons.length) {
      findings.push({
        lens: "workflow",
        severity: "high",
        rule: RULES.deadEnd,
        element: describeElement(form),
        detail: `This form has ${controls.length} field(s) and no submit control, so there is no way to complete it from the keyboard or the screen.`,
        certainty: "exact",
      })
      continue
    }

    // A button whose wording commits something, on a step with no visible
    // confirmation, is the failure mode that costs real money.
    for (const btn of buttons) {
      const label = (btn instanceof HTMLInputElement ? btn.value : btn.textContent ?? "").trim()
      checked++
      if (!label) continue
      if (classifySideEffect(label) === "irreversible") {
        const guarded =
          !!form.querySelector("[data-confirm], [aria-describedby]") ||
          /\b(review|confirm|check)\b/i.test(form.textContent ?? "")
        if (!guarded) {
          findings.push({
            lens: "workflow",
            severity: "medium",
            rule: RULES.ungatedSubmit,
            element: describeElement(btn),
            detail: `"${label}" reads as committing something, and nothing on this step tells the user what is about to happen. Whether that needs a confirmation is a judgement, which is why this is a house rule and not a standard.`,
            measured: label,
            certainty: "exact",
          })
        }
      }
    }

    // A required control that is disabled or read-only can never be satisfied,
    // so the form can never be submitted.
    for (const c of controls) {
      const required = c.hasAttribute("required") || c.getAttribute("aria-required") === "true"
      if (!required) continue
      checked++
      const el = c as HTMLInputElement
      if (el.disabled || el.readOnly) {
        findings.push({
          lens: "workflow",
          severity: "high",
          rule: RULES.unreachable,
          element: describeElement(c),
          detail: `Required, but ${el.disabled ? "disabled" : "read-only"}. Native validation will block submission and the user has no way to satisfy it.`,
          certainty: "exact",
        })
      }
    }
  }

  return { lens: "workflow", checked, findings, unknowns, notes }
}

// --- lens 3: theme -------------------------------------------------------

const HOUSE_MIN_TEXT_PX = 12

export function themeLens(ctx: Ctx): LensReport {
  const findings: Finding[] = []
  const unknowns: Finding[] = []
  const notes: string[] = []
  let checked = 0

  if (!ctx.hasLayout) {
    notes.push(
      "This document has no layout, so contrast and target size could not be measured. Rendering it in a frame first is what makes those computable."
    )
    return { lens: "theme", checked, findings, unknowns, notes }
  }

  const texts = [...ctx.doc.querySelectorAll<HTMLElement>("p, span, a, button, label, li, td, th, h1, h2, h3, h4, h5, h6, small, code, dt, dd")]
    .filter((el) => !isHidden(el))
    .filter((el) => (el.textContent ?? "").trim().length > 0)
    // Only elements that own their text, so a wrapper is not measured twice.
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim()))

  for (const el of texts) {
    const style = ctx.win.getComputedStyle(el)
    const size = parseFloat(style.fontSize)
    const weight = parseInt(style.fontWeight, 10) || 400
    checked++

    if (size && size < HOUSE_MIN_TEXT_PX) {
      findings.push({
        lens: "theme",
        severity: "low",
        rule: RULES.tinyText,
        element: describeElement(el),
        detail: `${size.toFixed(1)}px. WCAG sets no absolute minimum, so this is our own floor rather than a standard.`,
        measured: `${size.toFixed(1)}px`,
        threshold: `${HOUSE_MIN_TEXT_PX}px`,
        certainty: "exact",
      })
    }

    const fg = parseColor(style.color)
    const bg = resolveBackground(el, ctx.win)
    const { threshold, large } = requiredContrast(size, weight)

    if (!fg) {
      unknowns.push({
        lens: "theme",
        severity: "low",
        rule: RULES.contrast,
        element: describeElement(el),
        detail: `Text colour "${style.color}" is in a colour space this cannot resolve, so the ratio is unknown rather than passing.`,
        certainty: "unknown",
      })
      continue
    }
    if (bg.certainty === "unknown" || !bg.color) {
      unknowns.push({
        lens: "theme",
        severity: "low",
        rule: RULES.contrast,
        element: describeElement(el),
        detail: `Contrast not computable: ${bg.reason}. Reported as unknown, not as a pass.`,
        certainty: "unknown",
      })
      continue
    }

    const ratio = contrastRatio(fg, bg.color)
    if (ratio < threshold) {
      findings.push({
        lens: "theme",
        severity: ratio < threshold - 1 ? "high" : "medium",
        rule: RULES.contrast,
        element: describeElement(el),
        detail: `Measured ${ratio.toFixed(2)}:1 against the resolved background. SC 1.4.3 requires ${threshold}:1 for this text (${size.toFixed(1)}px${weight >= 700 ? " bold" : ""}${large ? ", which counts as large" : ""}).`,
        measured: `${ratio.toFixed(2)}:1`,
        threshold: `${threshold}:1`,
        certainty: "exact",
      })
    }
  }

  // Target size. SC 2.5.8 wants 24x24 CSS px. The inline exception is
  // evaluable: a text link whose height is the surrounding line-height, or
  // that sits in a sentence, is exempt. Nav/footer link lists on marketing
  // pages are exactly that, and listing each one is noise rather than a finding.
  let targetFlagged = 0
  let targetExempt = 0
  for (const el of ctx.doc.querySelectorAll<HTMLElement>("a[href], button, input[type=checkbox], input[type=radio], [role=button]")) {
    if (isHidden(el)) continue
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) continue
    checked++
    const style = ctx.win.getComputedStyle(el)
    const fontSize = parseFloat(style.fontSize) || 16
    const lineHeightRaw = parseFloat(style.lineHeight)
    const lineHeight = Number.isFinite(lineHeightRaw) ? lineHeightRaw : fontSize * 1.2
    const parent = el.parentElement ? ctx.win.getComputedStyle(el.parentElement) : null
    const parentLine = parent ? parseFloat(parent.lineHeight) : NaN
    const surroundingLine = Number.isFinite(parentLine) ? parentLine : lineHeight
    if (
      isTargetSizeExempt({
        tagName: el.tagName,
        display: style.display,
        width: r.width,
        height: r.height,
        fontSize,
        lineHeight: surroundingLine,
        inSentence: !!el.closest("p, li, td, dd, blockquote, figcaption, label"),
      })
    ) {
      targetExempt++
      continue
    }
    if (Math.min(r.width, r.height) < 24) {
      targetFlagged++
      findings.push({
        lens: "theme",
        severity: "low",
        rule: RULES.target,
        element: describeElement(el),
        detail: `${Math.round(r.width)}x${Math.round(r.height)} CSS px. SC 2.5.8 asks for 24x24 CSS pixels. Spacing and essential exceptions are not evaluated here.`,
        measured: `${Math.round(r.width)}x${Math.round(r.height)}`,
        threshold: "24x24",
        certainty: "exact",
      })
    }
  }
  if (targetExempt > 0) {
    notes.push(
      `Skipped ${targetExempt} text-sized link(s) under SC 2.5.8's inline exception (height constrained by line-height, or in a sentence).`
    )
  }
  if (targetFlagged > 0) {
    notes.push("Remaining target-size findings do not evaluate SC 2.5.8's spacing or essential exceptions.")
  }

  // Corner radii off a single scale. Openly a preference, not a rule.
  const radii = new Map<string, number>()
  for (const el of ctx.doc.querySelectorAll<HTMLElement>("button, input, select, textarea, .card, [class*=card], [class*=btn]")) {
    if (isHidden(el)) continue
    const r = ctx.win.getComputedStyle(el).borderTopLeftRadius
    if (r && r !== "0px") radii.set(r, (radii.get(r) ?? 0) + 1)
  }
  checked++
  if (radii.size > 4) {
    const list = [...radii.entries()].sort((a, b) => b[1] - a[1])
    findings.push({
      lens: "theme",
      severity: "low",
      rule: RULES.scale,
      element: "document",
      detail: `${radii.size} distinct corner radii in use (${list.slice(0, 5).map(([v, n]) => `${v} x${n}`).join(", ")}...). A shape system usually wants two or three. This is a preference of ours, not a standard.`,
      measured: `${radii.size} values`,
      threshold: "4 or fewer",
      certainty: "exact",
    })
  }

  collapseRepeatedFindings(findings)
  return { lens: "theme", checked, findings, unknowns, notes }
}

// --- cross-verification --------------------------------------------------

/**
 * Corroborate findings across lenses.
 *
 * A single lens flagging an element is a finding. Two lenses arriving at the
 * same element from different directions is stronger evidence, and worth
 * surfacing, because it usually means the element is genuinely broken rather
 * than merely unusual.
 */
export function crossVerify(reports: LensReport[]): LensReport[] {
  const byElement = new Map<string, Set<Lens>>()
  for (const r of reports) {
    for (const f of r.findings) {
      if (!byElement.has(f.element)) byElement.set(f.element, new Set())
      byElement.get(f.element)!.add(f.lens)
    }
  }
  return reports.map((r) => ({
    ...r,
    findings: r.findings.map((f) => {
      const lenses = [...(byElement.get(f.element) ?? [])].filter((l) => l !== f.lens)
      return lenses.length ? { ...f, corroboratedBy: lenses } : f
    }),
  }))
}

export function runLenses(doc: Document, which: Lens[] = ["bugs", "workflow", "theme"]): LensReport[] {
  const ctx = contextFor(doc)
  const reports: LensReport[] = []
  if (which.includes("bugs")) reports.push(bugLens(ctx))
  if (which.includes("workflow")) reports.push(workflowLens(ctx))
  if (which.includes("theme")) reports.push(themeLens(ctx))
  return crossVerify(reports)
}
